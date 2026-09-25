import { defineConfig, devices } from "@playwright/test";

/**
 * Os testes de interface rodam contra o build de produção (`next start`),
 * não contra o dev server: é onde o service worker e o comportamento
 * offline se parecem com o aparelho do motorista.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "off",
    // Este ambiente traz o Chromium pré-instalado; apontar direto evita
    // baixar de novo a cada execução.
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM ?? undefined,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--allow-insecure-localhost"],
    },
  },
  projects: [
    { name: "celular", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
  ],
});
