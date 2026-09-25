import { expect, test } from "@playwright/test";
import { banco, entrar } from "./apoio";

/**
 * Dois defeitos relatados pela empresa em 04/09/2026, e a funcionalidade
 * que veio junto.
 *
 *  1. Observação nova não salvava quando o item já tinha uma. A causa não
 *     era o item ter observação: era a fila. `sincronizar()` descartava
 *     qualquer pedido que chegasse enquanto uma sincronização já estava em
 *     curso, e a segunda observação nasce exatamente aí — durante o envio
 *     da primeira. Ela ficava parada até o tique de 60 segundos; fechar o
 *     app antes disso (ou sair da conta, que limpa o aparelho) perdia a
 *     anotação sem aviso nenhum.
 *
 *  2. Quando o servidor recusava a gravação — mês fechado, por exemplo —
 *     nada aparecia na tela. A anotação ficava presa na fila parecendo
 *     salva.
 *
 *  3. Observação geral do dia (item 0): o que não é sobre nenhum dos cinco
 *     itens. As observações por item continuam existindo, intactas.
 */

async function limpar() {
  await banco(async (c) => {
    await c.query("delete from public.observations");
    await c.query("delete from public.inspection_entries");
    await c.query("delete from public.month_closures");
  });
}

const contar = (where = "true") =>
  banco((c) => c.query(`select count(*)::int n from public.observations where ${where}`)).then(
    (r) => r.rows[0].n,
  );

test.describe.configure({ mode: "serial" });

test("observações seguidas no mesmo item chegam todas ao servidor", async ({ browser }) => {
  await limpar();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await entrar(page, "usuario-d0c02212@example.invalid");
  await page.getByRole("button", { name: "Conforme", exact: true }).first().click();
  await page.getByRole("button", { name: "Observação" }).first().click();

  // Sem pausa entre elas: é o caso que quebrava — cada uma nasce enquanto
  // a anterior ainda está subindo.
  for (let i = 1; i <= 4; i++) {
    const campo = page.getByRole("textbox", { name: "Nova observação" });
    await campo.fill(`nota ${i}`);
    await page.getByRole("button", { name: "Adicionar", exact: true }).click();
    await expect(page.getByText(`nota ${i}`)).toBeVisible();
  }

  await expect
    .poll(() => contar(), { timeout: 30_000, message: "nem toda observação subiu" })
    .toBe(4);

  // E fechar o aparelho logo depois não pode perder nada: é o que o
  // motorista faz na doca.
  await ctx.close();
  expect(await contar()).toBe(4);
});

test("observação geral do dia é separada das observações de item", async ({ page }) => {
  await limpar();
  await entrar(page, "usuario-d0c02212@example.invalid");

  // A observação do item continua onde estava.
  await page.getByRole("button", { name: "Observação" }).first().click();
  await page.getByRole("textbox", { name: "Nova observação" }).fill("nível do óleo no limite");
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect.poll(() => contar("item_number = 1"), { timeout: 20_000 }).toBe(1);
  await page.getByRole("button", { name: "Fechar", exact: true }).last().click();

  // E a geral é um cartão à parte, no fim da lista.
  await page.getByRole("button", { name: "Escrever observação geral" }).click();
  await expect(page.getByRole("dialog", { name: "Observações gerais do dia" })).toBeVisible();
  await page
    .getByRole("textbox", { name: "Nova observação" })
    .fill("saída atrasada, trânsito na Dutra");
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect.poll(() => contar("item_number = 0"), { timeout: 20_000 }).toBe(1);

  // A geral não contamina o item, e o item não contamina a geral.
  expect(await contar("item_number = 1")).toBe(1);
  await page.getByRole("button", { name: "Fechar", exact: true }).last().click();
  await expect(page.getByText("saída atrasada, trânsito na Dutra")).toBeVisible();

  // E ela aparece nas pendências com o nome certo, não como "Óleo".
  await page.goto("/nao-conformidades");
  await page.getByRole("button", { name: /Observações/ }).click();
  await expect(page.getByText("Observação geral do dia")).toBeVisible({ timeout: 20_000 });
});

test("mês fechado avisa em vez de fingir que salvou", async ({ page }) => {
  await limpar();
  await entrar(page, "usuario-d0c02212@example.invalid");
  await banco(async (c) => {
    const v = await c.query("select id from public.vehicles limit 1");
    const a = await c.query("select id from public.profiles where role='admin'");
    await c.query(
      `insert into public.month_closures (vehicle_id, month, year, closed_by)
       values ($1, extract(month from public.today_local())::smallint,
                   extract(year  from public.today_local())::smallint, $2)`,
      [v.rows[0].id, a.rows[0].id],
    );
  });
  await page.reload();
  await page.getByRole("button", { name: "Observação" }).first().click();

  await expect(page.getByText(/mês já foi fechado/i).last()).toBeVisible();
  await expect(page.getByRole("button", { name: "Adicionar", exact: true })).toHaveCount(0);
  expect(await contar()).toBe(0);
});
