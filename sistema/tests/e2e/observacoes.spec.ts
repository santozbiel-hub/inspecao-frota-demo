import { expect, test } from "@playwright/test";
import { banco, entrar } from "./apoio";

/**
 * O bug relatado pela empresa: uma observação escrita num item marcado
 * como Conforme não aparecia em lugar nenhum.
 *
 * Eram dois problemas somados:
 *  1. a fila subia observação, mas nada nunca baixava de volta — ela só
 *     existia no aparelho de quem digitou;
 *  2. a aba de pendências listava apenas `inspection_entries` com status
 *     NC, então observação nenhuma passava por ali.
 *
 * Este teste cobre o caminho inteiro, em dois navegadores separados:
 * o motorista escreve, e o administrador — noutro aparelho, que nunca
 * viu aquele texto — precisa enxergar.
 */
test.describe("observações aparecem nas pendências", () => {
  test.beforeAll(async () => {
    await banco(async (c) => {
      await c.query("delete from public.observations");
      await c.query("delete from public.inspection_entries");
      // Outra spec fecha o mês e não desfaz. Mês fechado desabilita os
      // botões do motorista, e o teste travaria por um motivo que não
      // tem nada a ver com o que ele está verificando.
      await c.query("delete from public.month_closures");
    });
  });

  test("observação em item Conforme chega ao administrador", async ({ browser }) => {
    // ---------------------------------------------- aparelho do motorista
    const doMotorista = await browser.newContext();
    const motorista = await doMotorista.newPage();
    await entrar(motorista, "usuario-d0c02212@example.invalid");

    // Marca o item 1 como CONFORME — o caso que estava quebrado.
    const cartaoItem1 = motorista.locator("article, div").filter({ hasText: "Óleo" }).first();
    await motorista.getByRole("button", { name: "Conforme", exact: true }).first().click();

    // E deixa uma observação nele.
    await motorista.getByRole("button", { name: "Observação" }).first().click();
    await motorista
      .getByRole("textbox", { name: "Nova observação" })
      .fill("Nível no limite, completei meio litro.");
    await motorista.getByRole("button", { name: "Adicionar" }).click();
    await expect(motorista.getByText("Nível no limite, completei meio litro.")).toBeVisible();
    await motorista.getByRole("button", { name: "Fechar", exact: true }).last().click();

    // Espera a observação realmente subir para o servidor.
    await expect
      .poll(
        async () => banco((c) => c.query("select count(*)::int n from public.observations"))
          .then((r) => r.rows[0].n),
        { timeout: 30_000, message: "a observação não chegou ao servidor" },
      )
      .toBe(1);

    // Confere que o item ficou mesmo como Conforme (não é um NC disfarçado).
    const status = await banco((c) =>
      c.query("select status from public.inspection_entries where item_number = 1"),
    );
    expect(status.rows[0]?.status).toBe("C");
    expect(cartaoItem1).toBeTruthy();

    // ------------------------------------------ aparelho do administrador
    // Contexto novo: IndexedDB vazio. Se a observação não vier do
    // servidor, não há como ela aparecer aqui.
    const doAdmin = await browser.newContext();
    const admin = await doAdmin.newPage();
    await entrar(admin, "usuario-52a681a1@example.invalid");

    await admin.goto("/nao-conformidades");
    await admin.getByRole("button", { name: /Observações/ }).click();

    await expect(admin.getByText("Nível no limite, completei meio litro.")).toBeVisible({
      timeout: 20_000,
    });
    // O contexto do item aparece junto: quem lê sabe que o item estava OK.
    await expect(admin.getByText("Óleo").first()).toBeVisible();
    await expect(admin.getByText("João Motorista", { exact: false }).first()).toBeVisible();

    await doMotorista.close();
    await doAdmin.close();
  });
});
