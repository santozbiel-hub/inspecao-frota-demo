import { expect, test } from "@playwright/test";
import { banco, entrar } from "./apoio";

/**
 * Dois inspetores no mesmo caminhão, no mesmo dia.
 *
 * Antes da migration 015 a chave única era (veículo, item, data), então o
 * segundo a marcar caía no caminho de UPDATE da linha do primeiro, a
 * policy `entries_update` recusava com 42501 e a marcação ficava presa na
 * fila do aparelho — sem nada aparecer na tela.
 *
 * A regra combinada com a empresa: ninguém sobrescreve ninguém, e na
 * grade "o mais grave manda" — basta um Não Conforme para o dia sair NC.
 */

const registros = () =>
  banco((c) =>
    c.query(
      `select p.name, e.status
         from public.inspection_entries e
         join public.profiles p on p.id = e.created_by
        where e.item_number = 1 and e.entry_date = public.today_local()
        order by p.name`,
    ),
  ).then((r) => r.rows as { name: string; status: string }[]);

test("cada inspetor tem o próprio registro, e o mais grave manda", async ({ browser }) => {
  await banco(async (c) => {
    await c.query("delete from public.observations");
    await c.query("delete from public.inspection_entries");
    await c.query("delete from public.month_closures");
  });

  const erros: string[] = [];
  const ctxJoao = await browser.newContext();
  const joao = await ctxJoao.newPage();
  const ctxMaria = await browser.newContext();
  const maria = await ctxMaria.newPage();
  for (const p of [joao, maria]) {
    p.on("response", async (r) => {
      if (r.url().includes("/rest/v1/inspection_entries") && r.status() >= 300) {
        erros.push(`HTTP ${r.status()} :: ${await r.text().catch(() => "")}`);
      }
    });
  }

  // João marca o item 1 como Conforme.
  await entrar(joao, "usuario-d0c02212@example.invalid");
  await joao.getByRole("button", { name: "Conforme", exact: true }).first().click();
  await expect.poll(registros, { timeout: 20_000 }).toHaveLength(1);

  // Maria, no aparelho dela, marca o MESMO item como Não Conforme.
  await entrar(maria, "usuario-dcd04bdc@example.invalid");
  await maria.getByRole("button", { name: "Não Conforme", exact: true }).first().click();
  await maria.getByRole("textbox", { name: /O que foi encontrado/ }).fill("pneu murcho");
  await maria.getByRole("button", { name: /Salvar não conformidade/ }).click();

  // Os dois registros coexistem — nenhum 42501, nada sobrescrito.
  await expect
    .poll(registros, { timeout: 25_000, message: JSON.stringify(erros) })
    .toEqual([
      { name: "João Motorista", status: "C" },
      { name: "Maria Motorista", status: "NC" },
    ]);
  expect(erros, "o servidor recusou alguma gravação").toEqual([]);

  // O João continua vendo o SEU Conforme no seletor, e é avisado do
  // registro da colega em vez de ver o dela no lugar do seu.
  await joao.reload();
  await expect(joao.getByText("Também registrado hoje")).toBeVisible({ timeout: 20_000 });
  await expect(joao.getByText("Maria Motorista")).toBeVisible();

  // E na grade o dia sai Não Conforme: o mais grave manda.
  await joao.goto("/grade");
  await joao.waitForTimeout(3000);
  const efetivo = await banco((c) =>
    c.query(
      // O veículo é o que o app escolheu sozinho (o primeiro da lista, por
      // marca), não um chute nosso — por isso vem do próprio registro.
      `select status from public.effective_entries(
         (select vehicle_id from public.inspection_entries
           where item_number = 1 and entry_date = public.today_local() limit 1),
         public.today_local(), public.today_local())
        where item_number = 1`,
    ),
  );
  expect(efetivo.rows[0]?.status).toBe("NC");

  await ctxJoao.close();
  await ctxMaria.close();
});
