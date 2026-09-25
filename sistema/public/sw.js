/**
 * Service worker da inspeção de frota.
 *
 * O trabalho dele é um só: garantir que o app ABRE sem sinal. Os dados
 * ficam no IndexedDB (ver src/lib/offline), não aqui — o cache aqui é da
 * casca: HTML, JS, CSS, ícones.
 *
 * Estratégias:
 *  - navegação  → rede primeiro, cai para a casca guardada
 *  - estáticos  → cache primeiro (o hash do Next já invalida sozinho)
 *  - API/Supabase → nunca passa por aqui; quem cuida é a fila do app
 */

// Ao mudar esta versão, o activate() apaga TODOS os caches antigos.
const VERSAO = "bp-frota-v2";
const CACHE_CASCA = `${VERSAO}-casca`;
const CACHE_ESTATICO = `${VERSAO}-estatico`;

const CASCA = ["/", "/hoje", "/painel", "/offline", "/manifest.webmanifest"];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(CACHE_CASCA).then((cache) =>
      // addAll falha inteiro se uma URL falhar; aqui uma rota indisponível
      // no momento da instalação não pode derrubar a instalação toda.
      Promise.allSettled(CASCA.map((url) => cache.add(url))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((chaves) =>
        Promise.all(
          chaves.filter((c) => !c.startsWith(VERSAO)).map((c) => caches.delete(c)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function ehEstatico(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    /\.(css|js|woff2?|png|svg|ico|webp)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (evento) => {
  const req = evento.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Chamadas ao Supabase (ou a qualquer outra origem) passam direto: se
  // falharem, quem resolve é a fila offline do app, não o cache.
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    evento.respondWith(
      fetch(req)
        .then((resposta) => {
          const copia = resposta.clone();
          caches.open(CACHE_CASCA).then((c) => c.put(req, copia));
          return resposta;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_CASCA);
          return (
            (await cache.match(req)) ||
            (await cache.match("/hoje")) ||
            (await cache.match("/offline")) ||
            new Response(
              "<!doctype html><meta charset=utf-8><title>Sem conexão</title>" +
                "<body style='font-family:system-ui;padding:2rem'>" +
                "<h1>Sem conexão</h1><p>Abra o app novamente quando o sinal voltar. " +
                "As marcações feitas continuam salvas no aparelho.</p>",
              { headers: { "content-type": "text/html; charset=utf-8" } },
            )
          );
        }),
    );
    return;
  }

  if (ehEstatico(url)) {
    evento.respondWith(
      caches.match(req).then(
        (acerto) =>
          acerto ||
          fetch(req).then((resposta) => {
            const copia = resposta.clone();
            caches.open(CACHE_ESTATICO).then((c) => c.put(req, copia));
            return resposta;
          }),
      ),
    );
  }
});

// A tela pede a sincronização assim que o app volta ao primeiro plano;
// aqui só repassamos o aviso de que a rede voltou.
self.addEventListener("message", (evento) => {
  if (evento.data === "sincronizar") {
    self.clients.matchAll().then((clientes) => {
      for (const c of clientes) c.postMessage("sincronizar");
    });
  }
});
