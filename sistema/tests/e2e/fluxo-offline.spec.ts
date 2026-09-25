import { expect, test } from "@playwright/test";
import { banco, entrar, esperarFilaVazia, jpegDeTeste } from "./apoio";

/**
 * Teste 2 — sincronização offline → online
 * Teste 5 — fluxo completo de ponta a ponta
 *
 * Roda só no projeto "celular": é o aparelho do motorista.
 */
test.describe("inspeção sem sinal e sincronização", () => {
  test.beforeEach(async () => {
    test.skip(test.info().project.name !== "celular", "cenário do aparelho do motorista");
    await banco(async (c) => {
      await c.query("delete from public.observations");
      await c.query("delete from public.inspection_entries");
      await c.query("delete from public.month_closures");
    });
  });

  test("marca a inspeção inteira offline, reconecta e nada se perde nem duplica", async ({
    page,
    context,
  }) => {
    await entrar(page, "usuario-d0c02212@example.invalid");
    await expect(page.getByText("0 de 5 registrados")).toBeVisible();

    // ---------------------------------------------------- cai a conexão
    await context.setOffline(true);
    await expect(page.getByText(/Sem conexão/)).toBeVisible();

    // Itens 1, 2 e 3: Conforme.
    for (const item of [1, 2, 3]) {
      await page
        .locator("li")
        .filter({ has: page.getByRole("heading", { level: 2 }) })
        .nth(item - 1)
        .getByRole("button", { name: "Conforme", exact: true })
        .click();
    }
    await expect(page.getByText("3 de 5 registrados")).toBeVisible();

    // Item 4: Não Conforme com descrição e foto.
    const cartao4 = page.locator("li").filter({ hasText: "Painel Thermo King" }).first();
    await cartao4.getByRole("button", { name: "Não Conforme" }).click();
    await page
      .getByRole("textbox")
      .filter({ hasNot: page.locator("[type]") })
      .last()
      .fill("Painel Thermo King apagando sozinho na partida.");
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "pneu.jpg",
      mimeType: "image/jpeg",
      buffer: jpegDeTeste(),
    });
    await expect(page.getByText(/Foto pronta/)).toBeVisible();
    await page.getByRole("button", { name: /Salvar não conformidade/ }).click();

    // Item 5: Conforme.
    await page
      .locator("li")
      .filter({ hasText: "Pneus" })
      .first()
      .getByRole("button", { name: "Conforme", exact: true })
      .click();

    await expect(page.getByText("5 de 5 registrados")).toBeVisible();

    // Tudo salvo no aparelho, nada no servidor ainda.
    await expect(page.getByText(/aguardando envio/).first()).toBeVisible();
    expect(
      await banco((c) => c.query("select count(*)::int as n from public.inspection_entries")),
    ).toMatchObject({ rows: [{ n: 0 }] });

    // O app sobrevive a fechar e reabrir sem sinal.
    await page.reload();
    await expect(page.getByText("5 de 5 registrados")).toBeVisible();

    // ---------------------------------------------------- volta a conexão
    await context.setOffline(false);
    await esperarFilaVazia(page);

    const linhas = await banco((c) =>
      c.query(
        "select item_number, status, nc_status, problem_description, photo_url from public.inspection_entries order by item_number",
      ),
    );
    expect(linhas.rows).toHaveLength(5); // 5 itens, nenhuma duplicata
    expect(linhas.rows.map((r) => r.status)).toEqual(["C", "C", "C", "NC", "C"]);
    expect(linhas.rows[3].problem_description).toContain("Painel Thermo King apagando");
    expect(linhas.rows[3].nc_status).toBe("pendente");

    // A foto subiu na fila própria e ligou na linha certa.
    await expect
      .poll(
        async () => {
          const r = await banco((c) =>
            c.query("select photo_url from public.inspection_entries where item_number = 4"),
          );
          return r.rows[0]?.photo_url ?? null;
        },
        { timeout: 30_000, message: "a foto não chegou" },
      )
      .not.toBeNull();

    // Sincronizar de novo não pode criar linha nova.
    await page.reload();
    await page.waitForTimeout(2500);
    const depois = await banco((c) =>
      c.query("select count(*)::int as n from public.inspection_entries"),
    );
    expect(depois.rows[0].n).toBe(5);
  });

  test("fluxo completo: motorista registra NC, administrador resolve, some das pendências", async ({
    page,
    context,
    browser,
  }) => {
    // ---- motorista, offline
    await entrar(page, "usuario-d0c02212@example.invalid");
    // Espera a tela do dia carregar antes de cortar a rede: o primeiro
    // acesso do aparelho precisa de sinal para baixar o catálogo.
    await expect(page.getByText("0 de 5 registrados")).toBeVisible();
    await context.setOffline(true);

    const cartao = page.locator("li").filter({ hasText: "Pneus" }).first();
    await cartao.getByRole("button", { name: "Não Conforme" }).click();
    await page
      .getByRole("textbox")
      .filter({ hasNot: page.locator("[type]") })
      .last()
      .fill("Pneu dianteiro esquerdo com desgaste no ombro.");
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "pneu.jpg",
      mimeType: "image/jpeg",
      buffer: jpegDeTeste(),
    });
    await page.getByRole("button", { name: /Salvar não conformidade/ }).click();
    await expect(page.getByText(/Pneu dianteiro esquerdo/).first()).toBeVisible();

    // ---- volta o sinal
    await context.setOffline(false);
    await esperarFilaVazia(page);

    const nc = await banco((c) =>
      c.query("select id, nc_status from public.inspection_entries where item_number = 5"),
    );
    expect(nc.rows).toHaveLength(1);
    expect(nc.rows[0].nc_status).toBe("pendente");

    // ---- administrador, em outro aparelho (contexto limpo de verdade)
    const contextoAdmin = await browser.newContext();
    const paginaAdmin = await contextoAdmin.newPage();
    await entrar(paginaAdmin, "usuario-52a681a1@example.invalid", "9999");

    await paginaAdmin.goto("/nao-conformidades");
    await expect(paginaAdmin.getByText(/Pneu dianteiro esquerdo/)).toBeVisible();
    await paginaAdmin.getByRole("button", { name: /Marcar como resolvida/ }).click();

    await expect
      .poll(
        async () => {
          const r = await banco((c) =>
            c.query("select nc_status from public.inspection_entries where item_number = 5"),
          );
          return r.rows[0]?.nc_status;
        },
        { timeout: 20_000 },
      )
      .toBe("resolvido");

    // Some da lista "em aberto".
    await paginaAdmin.reload();
    await expect(paginaAdmin.getByText(/Nenhuma não conformidade neste filtro/)).toBeVisible();
    await contextoAdmin.close();
  });

  test("uma marcação com falha de permissão fica marcada como falha, não some", async ({
    page,
    context,
  }) => {
    await entrar(page, "usuario-d0c02212@example.invalid");
    await expect(page.getByText("0 de 5 registrados")).toBeVisible();
    await context.setOffline(true);

    // Fecha o mês por fora: quando a fila subir, o RLS vai recusar.
    await banco(async (c) => {
      const v = await c.query("select id from public.vehicles order by brand, plate limit 1");
      const a = await c.query("select id from public.profiles where role = 'admin' limit 1");
      await c.query(
        "insert into public.month_closures (vehicle_id, month, year, closed_by) values ($1, extract(month from public.today_local())::smallint, extract(year from public.today_local())::smallint, $2)",
        [v.rows[0].id, a.rows[0].id],
      );
    });

    await page
      .locator("li")
      .filter({ hasText: "Óleo" })
      .first()
      .getByRole("button", { name: "Conforme", exact: true })
      .click();

    await context.setOffline(false);

    // O registro continua no aparelho, sinalizado como falha — nunca é
    // descartado em silêncio.
    await expect(page.getByText(/Falha ao enviar/).first()).toBeVisible({ timeout: 30_000 });
    const n = await banco((c) => c.query("select count(*)::int as n from public.inspection_entries"));
    expect(n.rows[0].n).toBe(0);
  });
});
