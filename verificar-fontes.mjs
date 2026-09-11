// Checa se as fontes continuam no ar e grava o resultado em dados/saude-fontes.json.
// Uso: node verificar-fontes.mjs   (leva alguns minutos; não roda no build, que precisa ser rápido)
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DADOS = join(dirname(fileURLToPath(import.meta.url)), "dados");
const { fontes } = JSON.parse(readFileSync(join(DADOS, "fontes.json"), "utf8"));

const checar = async (f) => {
  const controlador = new AbortController();
  const relogio = setTimeout(() => controlador.abort(), 20000);
  try {
    // HEAD é mais leve, mas muitos portais respondem 405; nesse caso tenta GET.
    let r = await fetch(f.url, { method: "HEAD", redirect: "follow", signal: controlador.signal,
      headers: { "user-agent": "CasoMaster/1.0 (verificador de links)" } });
    if (r.status === 405 || r.status === 403 || r.status === 501)
      r = await fetch(f.url, { method: "GET", redirect: "follow", signal: controlador.signal,
        headers: { "user-agent": "CasoMaster/1.0 (verificador de links)" } });
    return { id: f.id, status: r.status, final: r.url !== f.url ? r.url : null };
  } catch (e) {
    return { id: f.id, status: 0, erro: e.name === "AbortError" ? "tempo esgotado" : e.message };
  } finally { clearTimeout(relogio); }
};

// Em lotes, para não disparar 174 pedidos de uma vez.
const resultados = [];
for (let i = 0; i < fontes.length; i += 8) {
  const lote = fontes.slice(i, i + 8);
  resultados.push(...await Promise.all(lote.map(checar)));
  process.stdout.write(`\r${resultados.length}/${fontes.length} fontes checadas`);
}
process.stdout.write("\n");

const problemas = resultados.filter((r) => r.status === 0 || r.status >= 400);
const redirecionadas = resultados.filter((r) => r.final);
writeFileSync(join(DADOS, "saude-fontes.json"), JSON.stringify({
  verificado_em: new Date().toISOString().slice(0, 10),
  total: resultados.length,
  problemas: problemas.map((r) => ({ id: r.id, status: r.status, erro: r.erro || null })),
}, null, 2) + "\n");

console.log(`\n${resultados.length} fontes · ${problemas.length} com problema · ${redirecionadas.length} redirecionadas`);
for (const r of problemas) {
  const f = fontes.find((x) => x.id === r.id);
  console.log(`  ✗ ${r.id} · ${r.status || r.erro} · ${f.url}`);
}
process.exit(0);
