import { test } from "@playwright/test";
import { banco, diaUtilAtras, entrar } from "./apoio";

/**
 * Não é um teste: gera as imagens das telas para o relatório de entrega.
 * Roda só quando `CAPTURAR_TELAS=1`.
 */
test.describe("capturas", () => {
  test.skip(() => process.env.CAPTURAR_TELAS !== "1", "só quando pedido");

  test.beforeAll(async () => {
    await banco(async (c) => {
      const v = await c.query("select id from public.vehicles order by brand, plate limit 1");
      const u = await c.query("select id from public.profiles where role = 'inspector' limit 1");
      await c.query("delete from public.inspection_entries");
      await c.query(
        `insert into public.inspection_entries (vehicle_id,item_number,entry_date,status,created_by)
         select $1, g, ${diaUtilAtras(4)}, 'C', $2 from generate_series(1,5) g`,
        [v.rows[0].id, u.rows[0].id],
      );
      await c.query(
        `insert into public.inspection_entries (vehicle_id,item_number,entry_date,status,created_by)
         select $1, g, ${diaUtilAtras(3)}, 'C', $2 from generate_series(1,4) g`,
        [v.rows[0].id, u.rows[0].id],
      );
      await c.query(
        `insert into public.inspection_entries (vehicle_id,item_number,entry_date,status,nc_status,problem_description,created_by)
         values ($1, 5, ${diaUtilAtras(3)}, 'NC', 'pendente', 'Pneu dianteiro esquerdo com desgaste no ombro.', $2)`,
        [v.rows[0].id, u.rows[0].id],
      );
    });
  });

  test("telas", async ({ page }, info) => {
    const sufixo = info.project.name;
    await entrar(page, "usuario-52a681a1@example.invalid");

    for (const [rota, nome] of [
      ["/hoje", "hoje"],
      ["/painel", "painel"],
      ["/grade", "grade"],
      ["/nao-conformidades", "pendencias"],
    ] as const) {
      await page.goto(rota);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(600);
      await page.screenshot({ path: `capturas/${nome}-${sufixo}.png`, fullPage: true });
    }

    // A folha de impressão, como sai no PDF.
    if (sufixo === "desktop") {
      await page.goto("/grade");
      await page.waitForLoadState("networkidle");
      await page.emulateMedia({ media: "print" });
      await page.waitForTimeout(600);
      await page.screenshot({ path: "capturas/folha-impressa.png", fullPage: true });
      await page.emulateMedia({ media: "screen" });
    }
  });
});
