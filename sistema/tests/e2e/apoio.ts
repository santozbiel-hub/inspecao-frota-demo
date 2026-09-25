import { expect, type Page } from "@playwright/test";
import pg from "pg";

export const SENHA = "senha-de-teste";
export const URL_DB =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres@/bp_e2e?host=/tmp&port=5433";

/**
 * Expressão SQL para "N dias úteis atrás" (1 = o último dia útil).
 *
 * Os seeds da bateria usavam `public.today_local() - N`, que conta dias
 * corridos. Desde que domingo deixou de aceitar registro (constraint
 * `*_dia_util`), essa conta estoura sempre que o subtraendo cai num
 * domingo — e o dia da semana em que a bateria roda não é escolha de
 * ninguém. Rodar numa quarta quebrava; rodar numa quinta passava.
 */
export function diaUtilAtras(n: number): string {
  return `(select d::date
             from generate_series(public.today_local() - 40, public.today_local() - 1, interval '1 day') d
            where public.is_business_day(d::date)
            order by d desc
            offset ${Math.max(0, n - 1)} limit 1)`;
}

export async function banco<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: URL_DB });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Login completo + criação do PIN, que é o caminho do primeiro acesso. */
export async function entrar(page: Page, email: string, pin = "1234") {
  await page.goto("/hoje");
  await page.getByRole("textbox", { name: "E-mail" }).fill(email);
  await page.locator('input[type="password"]').fill(SENHA);
  await page.getByRole("button", { name: /^Entrar$/ }).click();

  await expect(page.getByText("Crie um PIN")).toBeVisible();
  await page.locator('input[aria-label="Novo PIN de 4 números"]').fill(pin);
  await expect(page.getByText("Confirme o PIN")).toBeVisible();
  await page.locator('input[aria-label="Confirmação do PIN"]').fill(pin);

  await expect(page.getByRole("banner")).toBeVisible();
}

/** Uma imagem JPEG de verdade, grande o bastante para a compressão ter o
 *  que fazer. */
export function jpegDeTeste(): Buffer {
  // JPEG mínimo válido 8x8 cinza; o canvas reamostra e recomprime.
  const base64 =
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy" +
    "MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIA" +
    "AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA" +
    "AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3" +
    "ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm" +
    "p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEA" +
    "AwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSEx" +
    "BhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElK" +
    "U1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3" +
    "uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iii" +
    "gD//2Q==";
  return Buffer.from(base64, "base64");
}

export async function esperarFilaVazia(page: Page) {
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const req = indexedDB.open("bp-frota");
              req.onsuccess = () => {
                const base = req.result;
                const tx = base.transaction("entries", "readonly");
                const todos = tx.objectStore("entries").getAll();
                todos.onsuccess = () => {
                  const pendentes = (todos.result as { _sync: string }[]).filter(
                    (e) => e._sync !== "sincronizado",
                  ).length;
                  base.close();
                  resolve(pendentes);
                };
              };
              req.onerror = () => resolve(-1);
            }),
        ),
      { timeout: 30_000, message: "a fila local não esvaziou" },
    )
    .toBe(0);
}
