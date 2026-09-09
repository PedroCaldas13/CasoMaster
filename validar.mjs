import { readFileSync, existsSync } from "node:fs";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const { fontes } = load("./dados/fontes.json");
const { entidades } = load("./dados/entidades.json");
const { afirmacoes } = load("./dados/afirmacoes.json");
const { casos } = load("./dados/casos.json");
const permitidas = load("./dados/fontes-permitidas.json");
const trilhas = existsSync(new URL("./dados/trilhas.json", import.meta.url)) ? load("./dados/trilhas.json").trilhas : [];

const idsFonte = new Set(fontes.map((f) => f.id));
const idsEnt = new Set(entidades.map((e) => e.id));
const idsAfr = new Set(afirmacoes.map((a) => a.id));
const idsCaso = new Set(casos.map((c) => c.id));
const erros = [];
const avisos = [];

const NATUREZAS = ["fato", "alegacao", "decisao", "arquivado", "desmentido"];
const DIVISOES = ["politico", "judiciario", "orgao-controle", "instituicao-privada", "nucleo-master"];

// ---------- FONTES ----------
const dominioDe = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
};
const nivelPermitido = (dom) => {
  if (!dom) return null;
  const chaves = Object.keys(permitidas.dominios);
  const hit = chaves.find((k) => dom === k || dom.endsWith("." + k));
  return hit ? permitidas.dominios[hit].nivel : null;
};

for (const f of fontes) {
  if (!f.url) { erros.push(`fonte ${f.id}: sem URL — toda fonte precisa de link`); continue; }
  const dom = dominioDe(f.url);
  if (permitidas._recusados[dom])
    erros.push(`fonte ${f.id}: domínio "${dom}" foi RECUSADO — ${permitidas._recusados[dom]}`);
  else if (nivelPermitido(dom) === null)
    erros.push(`fonte ${f.id}: domínio "${dom}" não está em fontes-permitidas.json — avaliar e adicionar (ou recusar) antes de usar`);
  else if (nivelPermitido(dom) !== f.nivel)
    avisos.push(`fonte ${f.id}: nível declarado ${f.nivel}, mas a lista diz ${nivelPermitido(dom)} para "${dom}"`);
}

// ---------- ENTIDADES ----------
for (const e of entidades)
  if (!DIVISOES.includes(e.grupo))
    erros.push(`entidade ${e.id}: divisão inválida "${e.grupo}" — use uma das cinco: ${DIVISOES.join(", ")}`);

// ---------- AFIRMAÇÕES ----------
for (const a of afirmacoes) {
  if (!NATUREZAS.includes(a.natureza)) erros.push(`${a.id}: natureza inválida "${a.natureza}"`);
  for (const e of a.envolve) if (!idsEnt.has(e)) erros.push(`${a.id}: entidade inexistente "${e}"`);
  if (!a.fontes?.length) erros.push(`${a.id}: sem fonte — não pode ser publicada`);
  for (const f of a.fontes) if (!idsFonte.has(f)) erros.push(`${a.id}: fonte inexistente "${f}"`);
  if (a.natureza === "alegacao" && !a.alegado_por) erros.push(`${a.id}: alegação sem "alegado_por"`);
  if (a.alegado_por && !idsEnt.has(a.alegado_por)) erros.push(`${a.id}: alegado_por inexistente "${a.alegado_por}"`);

  const pessoas = a.envolve.filter((e) => entidades.find((x) => x.id === e)?.tipo === "pessoa");
  if (a.natureza === "alegacao" && pessoas.length && !a.resposta_do_citado?.fonte)
    avisos.push(`${a.id}: alegação sobre pessoa sem resposta do citado registrada`);
  if (a.natureza === "alegacao" && a.fontes.length < 2)
    avisos.push(`${a.id}: alegação com fonte única — buscar corroboração`);
  const niveis = a.fontes.map((f) => fontes.find((x) => x.id === f)?.nivel ?? 9);
  if (Math.min(...niveis) >= 4) avisos.push(`${a.id}: apoiada apenas em agregador (nível 4)`);
}

// ---------- CASOS ----------
const afrEmCaso = new Set();
for (const c of casos) {
  if (!c.titulo?.trim()) erros.push(`caso ${c.id}: sem título`);
  if (!c.resumo?.trim()) erros.push(`caso ${c.id}: sem resumo`);
  if (!c.slug || !/^[a-z0-9-]+$/.test(c.slug)) erros.push(`caso ${c.id}: slug inválido`);
  if (!DIVISOES.includes(c.divisao_principal)) erros.push(`caso ${c.id}: divisão principal inválida "${c.divisao_principal}"`);
  if (!c.afirmacoes?.length) erros.push(`caso ${c.id}: caso sem afirmações — um caso é um agrupamento, não conteúdo próprio`);
  for (const id of c.afirmacoes) {
    if (!idsAfr.has(id)) erros.push(`caso ${c.id}: afirmação inexistente "${id}"`);
    afrEmCaso.add(id);
  }
  for (const id of c.casos_relacionados || [])
    if (!idsCaso.has(id)) erros.push(`caso ${c.id}: caso relacionado inexistente "${id}"`);

  const naturezas = c.afirmacoes.map((id) => afirmacoes.find((a) => a.id === id)?.natureza);
  const soAlegacoes = naturezas.length && naturezas.every((n) => n === "alegacao");
  if (soAlegacoes && !/teria|suspeit|apura|alega|investig|pede|aponta/i.test(c.titulo))
    avisos.push(`caso ${c.id}: só contém alegações, mas o título "${c.titulo}" soa afirmativo — revisar redação`);

  const img = c.imagem;
  if (img?.arquivo) {
    if (!img.licenca) erros.push(`caso ${c.id}: imagem sem licença — não pode ser publicada`);
    if (!img.credito) erros.push(`caso ${c.id}: imagem sem crédito`);
    if (!img.fonte) erros.push(`caso ${c.id}: imagem sem URL de origem`);
  } else {
    avisos.push(`caso ${c.id}: sem imagem (${img?.nota || "sem nota"})`);
  }
}
for (const a of afirmacoes)
  if (!afrEmCaso.has(a.id)) avisos.push(`${a.id}: afirmação fora de qualquer caso — não aparecerá na visão por casos`);

// ---------- TRILHAS DE LEITURA ----------
const slugs = new Set(casos.map((c) => c.slug));
for (const t of trilhas) {
  if (!t.casos?.length) erros.push(`trilha ${t.id}: sem casos`);
  for (const slug of t.casos || [])
    if (!slugs.has(slug)) erros.push(`trilha ${t.id}: caso inexistente "${slug}"`);
}

// ---------- SAÍDA ----------
console.log("=== VALIDAÇÃO ===");
console.log(`${entidades.length} entidades · ${afirmacoes.length} afirmações · ${casos.length} casos · ${fontes.length} fontes\n`);
if (erros.length) { console.log("ERROS (bloqueiam a publicação):"); erros.forEach((e) => console.log("  ✗ " + e)); console.log(); }
else console.log("Nenhum erro de integridade.\n");
if (avisos.length) { console.log("AVISOS (revisar antes de publicar):"); avisos.forEach((a) => console.log("  ! " + a)); }
process.exit(erros.length ? 1 : 0);
