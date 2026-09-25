import { expect, test, type Page } from "@playwright/test";
import { banco, diaUtilAtras, entrar } from "./apoio";

/**
 * Teste 4 — responsividade.
 *
 * Confere três coisas em cada tela, nos dois tamanhos: nada estoura para
 * os lados, os alvos de toque são tocáveis de verdade, e a grade do
 * administrador realmente troca de forma entre celular e computador.
 */

async function semRolagemHorizontal(page: Page) {
  const estouro = await page.evaluate(() => {
    const doc = document.documentElement;
    return { largura: doc.scrollWidth, janela: window.innerWidth };
  });
  expect(
    estouro.largura,
    `a página rola para o lado (${estouro.largura}px em ${estouro.janela}px)`,
  ).toBeLessThanOrEqual(estouro.janela + 1);
}

async function alvosDeToque(page: Page, minimo = 40) {
  const pequenos = await page.evaluate((min) => {
    const alvos = [...document.querySelectorAll("button, a[href], select, input[type=checkbox]")];
    return alvos
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const estilo = getComputedStyle(el);
        if (r.width === 0 || r.height === 0) return false;
        if (estilo.visibility === "hidden" || estilo.display === "none") return false;
        return r.height < min;
      })
      .map((el) => `${el.tagName}: ${(el.textContent ?? "").trim().slice(0, 40)}`);
  }, minimo);
  return pequenos;
}

const TELAS = ["/hoje", "/painel", "/grade", "/nao-conformidades", "/veiculos", "/usuarios"] as const;

test.describe("responsividade", () => {
  test.beforeAll(async () => {
    // Alguns registros para as telas não ficarem todas vazias.
    await banco(async (c) => {
      const v = await c.query("select id from public.vehicles order by plate limit 1");
      const u = await c.query("select id from public.profiles where role = 'inspector' limit 1");
      await c.query("delete from public.inspection_entries");
      await c.query(
        `insert into public.inspection_entries (vehicle_id,item_number,entry_date,status,created_by)
         select $1, g, ${diaUtilAtras(3)}, 'C', $2 from generate_series(1,3) g`,
        [v.rows[0].id, u.rows[0].id],
      );
      await c.query(
        `insert into public.inspection_entries (vehicle_id,item_number,entry_date,status,nc_status,problem_description,created_by)
         values ($1, 5, ${diaUtilAtras(3)}, 'NC', 'pendente', 'Pneu dianteiro esquerdo com desgaste.', $2)`,
        [v.rows[0].id, u.rows[0].id],
      );
    });
  });

  test("todas as telas cabem na largura, em celular e em computador", async ({ page }, info) => {
    await entrar(page, "usuario-52a681a1@example.invalid");

    for (const rota of TELAS) {
      await page.goto(rota);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("banner")).toBeVisible();
      await semRolagemHorizontal(page);

      const pequenos = await alvosDeToque(page);
      expect(pequenos, `alvos pequenos demais em ${rota} (${info.project.name})`).toEqual([]);
    }
  });

  test("a grade vira lista no celular e tabela no computador", async ({ page }, info) => {
    await entrar(page, "usuario-52a681a1@example.invalid");
    await page.goto("/grade");
    await page.waitForLoadState("networkidle");

    const tabela = page.locator("table").first();
    const listaDeDias = page.getByRole("button", { expanded: false }).filter({ hasText: /-feira|Sábado/ });

    if (info.project.name === "celular") {
      await expect(tabela).toBeHidden();
      await expect(listaDeDias.first()).toBeVisible();

      // E a lista abre mostrando os 5 itens do dia.
      await listaDeDias.first().click();
      for (const titulo of ["Óleo", "Água do reservatório", "Fluido e freio", "Painel Thermo King", "Pneus"]) {
        await expect(page.getByText(titulo, { exact: true }).first()).toBeVisible();
      }
    } else {
      await expect(tabela).toBeVisible();
      await expect(listaDeDias.first()).toBeHidden();
      // A tabela traz as 5 linhas de item.
      await expect(tabela.locator("tbody tr")).toHaveCount(5);
    }
  });

  test("os cartões do motorista têm botões grandes e legíveis", async ({ page }, info) => {
    test.skip(info.project.name !== "celular", "regra do aparelho do motorista");
    await entrar(page, "usuario-d0c02212@example.invalid");

    const botoes = page.getByRole("button", { name: "Conforme", exact: true });
    await expect(botoes).toHaveCount(5);

    for (let i = 0; i < 5; i++) {
      const caixa = await botoes.nth(i).boundingBox();
      expect(caixa!.height, "botão Conforme baixo demais para o dedo").toBeGreaterThanOrEqual(44);
      expect(caixa!.width).toBeGreaterThanOrEqual(120);
    }

    // O botão de observação existe em todos os itens, com ou sem status.
    // `exact` porque o cartão de observações gerais, no fim da lista, tem o
    // seu próprio botão — que não é o de nenhum item.
    await expect(page.getByRole("button", { name: "Observação", exact: true })).toHaveCount(5);
    await expect(
      page.getByRole("button", { name: /observaç(ão|ões) ger/i }),
    ).toHaveCount(1);
  });

  test("a navegação de polegar aparece só no celular", async ({ page }, info) => {
    await entrar(page, "usuario-52a681a1@example.invalid");
    const rodape = page.locator("nav.rodape-nav");
    const lateral = page.locator("nav.barra-lateral");
    if (info.project.name === "celular") {
      await expect(rodape).toBeVisible();
      await expect(lateral).toBeHidden();
    } else {
      await expect(rodape).toBeHidden();
      await expect(lateral).toBeVisible();
    }
  });
});
