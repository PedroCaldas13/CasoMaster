// Gera o site estático em site/ a partir de dados/. Sem dependências além do D3 (CDN) no grafo.
// Uso: node construir.mjs  (sai com código 1 se algum link interno estiver quebrado)
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = dirname(fileURLToPath(import.meta.url));
const DADOS = join(RAIZ, "dados");
const IMAGENS = join(RAIZ, "imagens");
const SITE = join(RAIZ, "site");

const load = (nome) => JSON.parse(readFileSync(join(DADOS, nome), "utf8"));
const { fontes } = load("fontes.json");
const { entidades } = load("entidades.json");
const { afirmacoes } = load("afirmacoes.json");
const { casos } = load("casos.json");
const permitidas = load("fontes-permitidas.json");

const DIVISOES = {
  "nucleo-master":       { nome: "Núcleo Master",         cor: "#9e3535" },
  "politico":            { nome: "Políticos",             cor: "#8a4a86" },
  "judiciario":          { nome: "Judiciário",            cor: "#3a5f9e" },
  "orgao-controle":      { nome: "Órgãos de controle",    cor: "#2e6f4e" },
  "instituicao-privada": { nome: "Instituições privadas", cor: "#9a6209" },
};
const NATUREZAS = {
  fato: "Fato", decisao: "Decisão", alegacao: "Alegação", arquivado: "Arquivado", desmentido: "Desmentido",
};
const NIVEIS = {
  1: "Documento ou comunicado oficial do próprio órgão",
  2: "Veículo com redação e apuração próprias",
  3: "Veículo confiável usado para consolidação",
  4: "Agregador, só como ponto de partida",
};
const AVISO = "Ninguém citado neste site foi condenado. Investigação não é sentença.";

// ---------- índices ----------
const porId = (lista) => new Map(lista.map((x) => [x.id, x]));
const entPorId = porId(entidades);
const afrPorId = porId(afirmacoes);
const fontePorId = porId(fontes);
const casoPorId = porId(casos);

const casosDaAfirmacao = new Map();
for (const c of casos)
  for (const id of c.afirmacoes)
    casosDaAfirmacao.set(id, [...(casosDaAfirmacao.get(id) || []), c]);

const porData = (a, b) => (a.data || "").localeCompare(b.data || "");
const entidadesDaAfirmacao = (a) => [...new Set([...a.envolve, ...(a.alegado_por ? [a.alegado_por] : [])])];
const afirmacoesDaEntidade = (id) => afirmacoes.filter((a) => entidadesDaAfirmacao(a).includes(id));
const casosDaEntidade = (id) => {
  const ids = new Set(afirmacoesDaEntidade(id).map((a) => a.id));
  return casos.filter((c) => c.afirmacoes.some((x) => ids.has(x)));
};
const divisoesDaAfirmacao = (a) =>
  [...new Set(entidadesDaAfirmacao(a).map((id) => entPorId.get(id)?.grupo).filter(Boolean))];
const dataDoCaso = (c) => c.afirmacoes.map((id) => afrPorId.get(id)?.data || "").filter(Boolean).sort()[0] || "";
const casosCronologicos = [...casos].sort((a, b) => dataDoCaso(a).localeCompare(dataDoCaso(b)));
const conferida = (obj) => obj.proposto_por !== "agente";

// Uso de cada fonte: afirmações que a citam, mais respostas do citado.
const usoDaFonte = new Map(fontes.map((f) => [f.id, 0]));
for (const a of afirmacoes) {
  for (const id of a.fontes) usoDaFonte.set(id, (usoDaFonte.get(id) || 0) + 1);
  if (a.resposta_do_citado?.fonte) usoDaFonte.set(a.resposta_do_citado.fonte, (usoDaFonte.get(a.resposta_do_citado.fonte) || 0) + 1);
}

// O grafo é derivado: duas entidades na mesma afirmação viram aresta; peso = nº de afirmações.
const arestas = new Map();
for (const a of afirmacoes) {
  const ids = a.envolve.filter((id) => entPorId.has(id)).sort();
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const chave = `${ids[i]}|${ids[j]}`;
      const ar = arestas.get(chave) || { source: ids[i], target: ids[j], peso: 0, afirmacoes: [] };
      ar.peso++; ar.afirmacoes.push(a.id);
      arestas.set(chave, ar);
    }
}
const grafo = {
  nodes: entidades.map((e) => ({ id: e.id, nome: e.nome, grupo: e.grupo, tipo: e.tipo, grau: 0 })),
  links: [...arestas.values()],
};
for (const l of grafo.links) for (const n of grafo.nodes) if (n.id === l.source || n.id === l.target) n.grau += l.peso;
const vizinhosDe = (id) => grafo.links.filter((l) => l.source === id || l.target === id)
  .map((l) => [entPorId.get(l.source === id ? l.target : l.source), l.peso]).filter(([v]) => v)
  .sort((a, b) => b[1] - a[1] || a[0].nome.localeCompare(b[0].nome));

const dataBR = (iso) => {
  if (!iso) return "sem data";
  const [a, m, d] = iso.split("-");
  return d ? `${d}/${m}/${a}` : m ? `${m}/${a}` : a;
};

// ---------- índice de busca ----------
const nomeDe = (id) => entPorId.get(id)?.nome || id;
const indiceBusca = [
  ...entidades.map((e) => ({
    t: "entidade", titulo: e.nome, texto: e.descricao || "", extra: DIVISOES[e.grupo]?.nome || "",
    url: `entidade/${e.id}.html`, divisoes: [e.grupo],
  })),
  ...casos.map((c) => {
    const ents = new Set(c.afirmacoes.flatMap((id) => { const a = afrPorId.get(id); return a ? entidadesDaAfirmacao(a) : []; }));
    return {
      t: "caso", titulo: c.titulo, texto: c.resumo, extra: [...ents].map(nomeDe).join(" · "),
      url: `caso/${c.slug}.html`, divisoes: [c.divisao_principal],
    };
  }),
  ...afirmacoes.map((a) => {
    const caso = (casosDaAfirmacao.get(a.id) || [])[0];
    return {
      t: "afirmacao", titulo: `${dataBR(a.data)} · ${NATUREZAS[a.natureza] || a.natureza}`, texto: a.texto,
      extra: entidadesDaAfirmacao(a).map(nomeDe).join(" · "),
      url: caso ? `caso/${caso.slug}.html#${a.id}` : `linha-do-tempo.html#${a.id}`, divisoes: divisoesDaAfirmacao(a),
    };
  }),
];

// ---------- utilitários de HTML ----------
const h = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const json = (obj) => JSON.stringify(obj).replace(/</g, "\\u003c");
const raizDe = (profundidade) => (profundidade === 0 ? "./" : "../".repeat(profundidade));
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

const linkEntidade = (id, raiz) => {
  const e = entPorId.get(id);
  return e
    ? `<a class="entidade" href="${raiz}entidade/${h(e.id)}.html" style="--cor:var(--${h(e.grupo)})">${h(e.nome)}</a>`
    : `<span class="entidade desconhecida">${h(id)}</span>`;
};
const linkCaso = (c, raiz) => `<a href="${raiz}caso/${h(c.slug)}.html">${h(c.titulo)}</a>`;
const rotuloDivisao = (id) => {
  const d = DIVISOES[id];
  return d ? `<span class="divisao" style="--cor:var(--${h(id)})">${h(d.nome)}</span>` : "";
};
const rotuloNatureza = (n) => `<span class="natureza natureza-${h(n)}">${h(NATUREZAS[n] || n)}</span>`;

// Selo editorial: o que veio do agente e ainda não passou por um humano fica marcado.
const selo = (obj) => conferida(obj)
  ? `<span class="selo conferida" title="Registro conferido contra a fonte por um humano">conferida</span>`
  : `<span class="selo nao-conferida" title="Registro proposto pelo agente a partir das fontes; ainda não conferido por um humano">não conferida</span>`;

const linkFonte = (id) => {
  const f = fontePorId.get(id);
  if (!f) return `<span class="fonte desconhecida">${h(id)}</span>`;
  const rotulo = `${f.veiculo ? f.veiculo + " — " : ""}${f.titulo || f.url}`;
  return `<a class="fonte" href="${h(f.url)}" target="_blank" rel="noopener">${h(rotulo)}</a> <small>(nível ${h(f.nivel)}${f.data ? ", " + dataBR(f.data) : ""})</small>`;
};

const renderAfirmacao = (a, raiz, { mostrarCasos = true } = {}) => {
  const casosDela = casosDaAfirmacao.get(a.id) || [];
  const partes = [plural(a.fontes.length, "fonte", "fontes")];
  if (mostrarCasos && casosDela.length) partes.push(plural(casosDela.length, "caso", "casos"));
  return `
<article class="afirmacao" id="${h(a.id)}" data-natureza="${h(a.natureza)}" data-divisoes="${h(divisoesDaAfirmacao(a).join(" "))}">
  <header>
    <time datetime="${h(a.data || "")}">${h(dataBR(a.data))}</time>
    ${rotuloNatureza(a.natureza)}
    ${a.alegado_por ? `<span class="alegado-por">por ${linkEntidade(a.alegado_por, raiz)}</span>` : ""}
    ${selo(a)}
  </header>
  <p class="texto">${h(a.texto)}</p>
  <p class="envolve">${a.envolve.map((id) => linkEntidade(id, raiz)).join(" ")}</p>
  ${a.resposta_do_citado?.texto ? `
  <blockquote class="resposta">
    <span class="rotulo">Resposta do citado</span> ${h(a.resposta_do_citado.texto)}
    ${a.resposta_do_citado.fonte ? `<small>${linkFonte(a.resposta_do_citado.fonte)}</small>` : ""}
  </blockquote>` : ""}
  <details class="mais">
    <summary>${partes.join(" · ")}</summary>
    <ul class="fontes">${a.fontes.map((id) => `<li>${linkFonte(id)}</li>`).join("")}</ul>
    ${mostrarCasos && casosDela.length ? `<p class="casos">Casos: ${casosDela.map((c) => linkCaso(c, raiz)).join(", ")}</p>` : ""}
  </details>
</article>`;
};

const renderAfirmacaoCurta = (a, caso, raiz) => `
<li class="afirmacao-curta" data-natureza="${h(a.natureza)}">
  <time datetime="${h(a.data || "")}">${h(dataBR(a.data))}</time> ${rotuloNatureza(a.natureza)}
  <span>${h(a.texto)}</span>
  <a href="${raiz}caso/${h(caso.slug)}.html#${h(a.id)}"><small>ver no caso</small></a>
</li>`;

const imagemOuPlaceholder = (c, raiz) => {
  const d = DIVISOES[c.divisao_principal];
  return c.imagem?.arquivo
    ? `<figure><img src="${raiz}${h(c.imagem.arquivo)}" alt="" loading="lazy"><figcaption>${h(c.imagem.credito)} · ${h(c.imagem.licenca)}</figcaption></figure>`
    : `<div class="placeholder" style="--cor:var(--${h(c.divisao_principal)})" data-nome="${h(d?.nome || "")}" role="img" aria-label="Sem imagem"></div>`;
};

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesDe = (iso) => { if (!iso) return ""; const [a, m] = iso.split("-"); return m ? `${MESES[+m - 1]} ${a}` : a; };
const resumoCurto = (t, n = 150) => { const f = (t.match(/^.*?[.;](?=\s|$)/) || [t])[0]; return f.length > n ? f.slice(0, n).replace(/\s+\S*$/, "") + "…" : f; };

const renderLinhaDoTempo = (lista, raiz) => {
  let mesAnterior = null;
  const cartoes = lista.map((a) => {
    const mes = mesDe(a.data);
    const novoMes = mes !== mesAnterior; mesAnterior = mes;
    const ents = a.envolve.slice(0, 3).map((id) => linkEntidade(id, raiz)).join(" ") + (a.envolve.length > 3 ? ` <small>+${a.envolve.length - 3}</small>` : "");
    const seusCasos = (casosDaAfirmacao.get(a.id) || []).map((c) => c.slug).join(" ");
    return `
    <article class="marco${novoMes ? " inicio-mes" : ""}" data-mes="${h(mes)}" data-id="${h(a.id)}" data-data="${h(a.data || "")}" data-natureza="${h(a.natureza)}" data-divisoes="${h(divisoesDaAfirmacao(a).join(" "))}" data-casos="${h(seusCasos)}" data-entidades="${h(entidadesDaAfirmacao(a).join(" "))}" tabindex="0" role="button" aria-expanded="false">
      <header><time datetime="${h(a.data || "")}">${h(dataBR(a.data))}</time> ${rotuloNatureza(a.natureza)}</header>
      <p class="frase">${h(resumoCurto(a.texto))}</p>
      <p class="quem">${ents}</p>
    </article>`;
  }).join("\n");
  const opcoesCasos = casosCronologicos.map((c) => `<option value="${h(c.slug)}">${h(c.titulo)}</option>`).join("");
  const opcoesEnts = [...entidades].sort((a, b) => a.nome.localeCompare(b.nome)).map((e) => `<option value="${h(e.id)}">${h(e.nome)}</option>`).join("");
  const naturezas = Object.entries(NATUREZAS).filter(([n]) => afirmacoes.some((a) => a.natureza === n))
    .map(([n, nome]) => `<label class="natureza natureza-${n}"><input type="checkbox" name="natureza" value="${n}" checked> ${h(nome)}</label>`).join("");
  return `
<section id="linha-do-tempo" class="linha">
  <div class="linha-cabecalho">
    <h2>Linha do tempo <small>${plural(lista.length, "afirmação", "afirmações")} · clique num cartão para ler</small></h2>
    <div class="linha-nav">
      <button type="button" data-dir="-1" aria-label="Anterior">←</button>
      <button type="button" data-dir="1" aria-label="Próxima">→</button>
    </div>
  </div>
  <form class="filtros-linha" onsubmit="return false">
    <fieldset class="naturezas"><legend>Natureza</legend>${naturezas}</fieldset>
    <label>Caso <select id="filtro-caso"><option value="">Todos</option>${opcoesCasos}</select></label>
    <label>Entidade <select id="filtro-entidade"><option value="">Todas</option>${opcoesEnts}</select></label>
    <label>De <input type="month" id="filtro-de"></label>
    <label>Até <input type="month" id="filtro-ate"></label>
    <button type="button" id="limpar-filtros">Limpar</button>
    <small id="contagem-linha"></small>
  </form>
  <div class="trilho" tabindex="0" aria-label="Linha do tempo, role para o lado">
    ${cartoes}
  </div>
  <p id="linha-vazia" class="vazio" hidden>Nenhuma afirmação com esses filtros.</p>
  <div id="linha-detalhe" class="linha-detalhe" hidden>
    <button type="button" class="fechar" aria-label="Fechar">×</button>
    ${lista.map((a) => `<div class="detalhe-item" data-id="${h(a.id)}" hidden>${renderAfirmacao(a, raiz)}</div>`).join("\n")}
  </div>
</section>`;
};

// Grafo local de uma entidade: SVG estático, vizinhos num círculo, sem biblioteca.
const renderGrafoLocal = (e, raiz) => {
  const viz = vizinhosDe(e.id);
  if (!viz.length) return "";
  const S = 320, cx = S / 2, cy = S / 2, R = 118;
  const pontos = viz.map(([v, peso], i) => {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / viz.length;
    return { v, peso, x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang), ang };
  });
  const linhas = pontos.map((p) =>
    `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke-width="${(0.8 + p.peso * 0.9).toFixed(1)}"><title>${plural(p.peso, "afirmação", "afirmações")}</title></line>`).join("");
  const nos = pontos.map((p) => {
    const direita = Math.cos(p.ang) > 0.1, esquerda = Math.cos(p.ang) < -0.1;
    const anchor = direita ? "start" : esquerda ? "end" : "middle";
    const dx = direita ? 9 : esquerda ? -9 : 0;
    const dy = Math.sin(p.ang) < -0.5 ? -10 : Math.sin(p.ang) > 0.5 ? 16 : 4;
    return `<a href="${raiz}entidade/${h(p.v.id)}.html"><g class="no">
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(4 + Math.sqrt(p.peso) * 1.6).toFixed(1)}" fill="var(--${h(p.v.grupo)})"/>
      <text x="${(p.x + dx).toFixed(1)}" y="${(p.y + dy).toFixed(1)}" text-anchor="${anchor}">${h(p.v.nome)}</text>
      <title>${h(p.v.nome)} — ${plural(p.peso, "afirmação em comum", "afirmações em comum")}</title>
    </g></a>`;
  }).join("");
  return `
<svg class="grafo-local" viewBox="0 0 ${S} ${S}" role="img" aria-label="Ligações de ${h(e.nome)}">
  <g class="arestas">${linhas}</g>
  ${nos}
  <circle cx="${cx}" cy="${cy}" r="9" fill="var(--${h(e.grupo)})"/>
</svg>`;
};

// ---------- markdown mínimo ----------
// Além de negrito e links, resolve [[caso:slug|texto]] e [[ent:id|texto]] para páginas internas.
const slugDe = (t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const inline = (s, raiz = "./") =>
  h(s)
    .replace(/\[\[caso:([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g, (_, slug, texto) => {
      const c = casos.find((x) => x.slug === slug);
      return c ? `<a href="${raiz}caso/${h(c.slug)}.html">${texto || h(c.titulo)}</a>` : `<span class="desconhecida">${texto || slug}</span>`;
    })
    .replace(/\[\[ent:([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g, (_, id, texto) => {
      const e = entPorId.get(id);
      return e ? `<a class="entidade" href="${raiz}entidade/${h(e.id)}.html" style="--cor:var(--${h(e.grupo)})">${texto || h(e.nome)}</a>` : `<span class="desconhecida">${texto || id}</span>`;
    })
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

const markdown = (md, raiz = "./") => {
  const saida = [];
  const capitulos = [];
  let paragrafo = [];
  let lista = null;
  const fechaParagrafo = () => { if (paragrafo.length) { saida.push(`<p>${inline(paragrafo.join(" "), raiz)}</p>`); paragrafo = []; } };
  const fechaLista = () => { if (lista) { saida.push(`<ul>${lista.join("")}</ul>`); lista = null; } };
  for (const linha of md.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    const t = linha.trim();
    const titulo = t.match(/^(#{1,3})\s+(.*?)(?:\s*\{(\d{4}-\d{2})\.\.(\d{4}-\d{2})\})?\s*$/);
    if (titulo) {
      fechaParagrafo(); fechaLista();
      const n = titulo[1].length + 1, id = slugDe(titulo[2]);
      const periodo = titulo[3] ? ` <a class="ver-linha" href="${raiz}linha-do-tempo.html?de=${titulo[3]}&ate=${titulo[4]}#linha-do-tempo" data-de="${titulo[3]}" data-ate="${titulo[4]}">ver na linha do tempo →</a>` : "";
      if (n === 3) capitulos.push({ id, titulo: titulo[2], de: titulo[3], ate: titulo[4] });
      saida.push(`<h${n} id="${id}">${inline(titulo[2], raiz)}${periodo}</h${n}>`);
    }
    else if (t.startsWith("- ")) { fechaParagrafo(); (lista ||= []).push(`<li>${inline(t.slice(2), raiz)}</li>`); }
    else if (t === "") { fechaParagrafo(); fechaLista(); }
    else { fechaLista(); paragrafo.push(t); }
  }
  fechaParagrafo(); fechaLista();
  return { html: saida.join("\n"), capitulos };
};
const lerMd = (nome, padrao) => existsSync(join(DADOS, nome)) ? readFileSync(join(DADOS, nome), "utf8") : padrao;
const sobreHtml = markdown(lerMd("sobre.md", "# Sobre\n\nTODO: criar dados/sobre.md")).html;
const primeiroParagrafo = (sobreHtml.match(/<p>([\s\S]*?)<\/p>/) || [])[1] || "";
const introducao = markdown(lerMd("introducao.md", "# O caso\n\nTODO: escrever dados/introducao.md"));

// ---------- estilo ----------
const VARS_CLARO = `
  --fundo:#fbfaf7;--superficie:#fff;--texto:#1d1c1a;--texto-suave:#6b675f;--borda:#e4e1da;--borda-forte:#b9b4aa;--link:#2b4c8a;
  --nucleo-master:#9e3535;--politico:#8a4a86;--judiciario:#3a5f9e;--orgao-controle:#2e6f4e;--instituicao-privada:#9a6209;
  --fato:#1d6b41;--decisao:#2f5da3;--alegacao:#b06a00;--desmentido:#b02a2a;--arquivado:#7a766e;`;
const VARS_ESCURO = `
  --fundo:#151514;--superficie:#1d1d1b;--texto:#e8e5df;--texto-suave:#9d988f;--borda:#2c2b29;--borda-forte:#54514b;--link:#9db7e6;
  --nucleo-master:#d97b7b;--politico:#c58cc1;--judiciario:#8aa8db;--orgao-controle:#7fbf9a;--instituicao-privada:#d9a44a;
  --fato:#7fcf9e;--decisao:#93b3ec;--alegacao:#e8b562;--desmentido:#ea8c8c;--arquivado:#a19c93;`;

const CSS = `
:root{color-scheme:light dark;${VARS_CLARO}
  --serifa:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Times New Roman",serif;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --margem:clamp(1rem,4vw,3.5rem);
}
:root[data-tema=escuro]{${VARS_ESCURO}}
:root[data-tema=claro]{color-scheme:light}
:root[data-tema=escuro]{color-scheme:dark}
@media (prefers-color-scheme:dark){:root:not([data-tema=claro]){${VARS_ESCURO}}}
[hidden]{display:none!important}
*{box-sizing:border-box}
html{background:var(--fundo);scroll-padding-top:5rem}
body{font-family:var(--sans);color:var(--texto);background:var(--fundo);line-height:1.6;margin:0;padding:0 var(--margem) 4rem}
a{color:var(--link)}
h1,h2,h3,.marca{font-family:var(--serifa);font-weight:600;letter-spacing:-.01em;line-height:1.2}
h1{font-size:clamp(1.8rem,3.2vw,2.6rem);margin:2.25rem 0 .75rem}
h2{font-size:1.4rem;margin:2.25rem 0 .75rem}
h2 small,h1 small{font-family:var(--sans);font-weight:400;font-size:.8rem;color:var(--texto-suave);margin-left:.5rem;letter-spacing:0}
h3{font-size:1.1rem;margin:1rem 0 .35rem}
small{color:var(--texto-suave)}
button,select,input[type=search]{font:inherit;font-size:.88rem;background:transparent;color:var(--texto);border:1px solid var(--borda-forte);border-radius:999px;padding:.3rem .8rem}
button{cursor:pointer}button:hover{border-color:var(--texto)}
details>summary{cursor:pointer;color:var(--texto-suave);font-size:.85rem;list-style:none}
details>summary::-webkit-details-marker{display:none}
details>summary::before{content:"+ ";}
details[open]>summary::before{content:"− ";}
.vazio{color:var(--texto-suave);font-style:italic}
.prosa{max-width:44rem}
/* cabeçalho */
.topo{position:sticky;top:0;z-index:5;background:var(--fundo);display:flex;flex-wrap:wrap;align-items:center;gap:.5rem 2rem;padding:1rem 0 .7rem;border-bottom:1px solid var(--borda)}
.marca{font-size:1.25rem;color:var(--texto);text-decoration:none}
.visualizacoes,.secundaria{display:flex;gap:1.25rem;overflow-x:auto}
.visualizacoes a,.secundaria a{color:var(--texto-suave);text-decoration:none;padding:.2rem 0;border-bottom:1px solid transparent;white-space:nowrap}
.visualizacoes a:hover,.secundaria a:hover{color:var(--texto)}
.visualizacoes a[aria-current],.secundaria a[aria-current]{color:var(--texto);border-bottom-color:var(--texto)}
.secundaria{gap:1rem;font-size:.88rem}
.controles{margin-left:auto;display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;font-size:.88rem}
.controles label{display:flex;gap:.4rem;align-items:center;color:var(--texto-suave)}
.busca input{width:17rem;max-width:100%}
#tema{width:2rem;height:2rem;padding:0;line-height:1;font-size:1rem}
.aviso{font-size:.8rem;color:var(--texto-suave);margin:.6rem 0 0;padding:0}
.aviso::before{content:"";display:inline-block;width:.4rem;height:.4rem;border-radius:50%;background:var(--alegacao);margin-right:.5rem;vertical-align:middle}
footer{margin-top:4rem;padding-top:1rem;border-top:1px solid var(--borda);font-size:.82rem;color:var(--texto-suave)}
/* abertura da página inicial */
.abertura{display:flex;flex-wrap:wrap;gap:1.5rem 4rem;align-items:flex-end;justify-content:space-between;margin:2.5rem 0 1rem}
.abertura .lede{font-family:var(--serifa);font-size:clamp(1.2rem,2vw,1.55rem);line-height:1.4;max-width:56rem;margin:0}
.abertura .lede a{display:block;font-family:var(--sans);font-size:.88rem;margin-top:.6rem;text-decoration:none;color:var(--texto-suave)}
.abertura .lede a:hover{color:var(--texto)}
.numeros{display:flex;gap:2.5rem;margin:0;flex-wrap:wrap}
.numeros div{display:flex;flex-direction:column}
.numeros dt{font-size:.74rem;letter-spacing:.06em;text-transform:uppercase;color:var(--texto-suave);order:2}
.numeros dd{margin:0;font-family:var(--serifa);font-size:2rem;line-height:1.1}
.numeros dd small{font-family:var(--sans);font-size:.78rem;margin-left:.3rem}
/* texto corrido em serifa */
.sobre p,.resumo,.descricao,.afirmacao .texto,.resposta,.card .corpo p{font-family:var(--serifa)}
.sobre h2{margin-top:1.75rem}
.sobre p,.descricao{font-size:1.08rem}
.resumo{font-size:1.22rem;line-height:1.55;margin:1rem 0 2rem}
/* rótulos: só texto e um ponto de cor */
.divisao,.natureza,.selo{font-family:var(--sans);font-size:.74rem;letter-spacing:.06em;text-transform:uppercase;color:var(--cor,var(--texto-suave));white-space:nowrap}
.divisao::before,.natureza::before{content:"";display:inline-block;width:.45rem;height:.45rem;border-radius:50%;background:currentColor;margin-right:.4rem;vertical-align:middle;position:relative;top:-1px}
.natureza-fato{--cor:var(--fato)}.natureza-decisao{--cor:var(--decisao)}.natureza-alegacao{--cor:var(--alegacao)}.natureza-desmentido{--cor:var(--desmentido)}.natureza-arquivado{--cor:var(--arquivado)}
.selo{letter-spacing:.04em;text-transform:none;border-bottom:1px dotted var(--borda-forte);cursor:help}
.selo.nao-conferida{color:var(--alegacao);border-bottom-color:var(--alegacao)}
.selo.conferida{color:var(--texto-suave)}
a.entidade{color:var(--texto);text-decoration:none;border-bottom:1px solid var(--cor,var(--borda-forte))}
a.entidade:hover{color:var(--cor)}
.envolve a.entidade{margin-right:.7rem;font-size:.9rem}
/* afirmação */
.afirmacao{margin:1.75rem 0}
.afirmacao header{font-size:.82rem;color:var(--texto-suave);display:flex;gap:.7rem;flex-wrap:wrap;align-items:center}
.afirmacao header time{font-variant-numeric:tabular-nums;color:var(--texto)}
.afirmacao header .selo{margin-left:auto}
.afirmacao .texto{margin:.45rem 0 .5rem;font-size:1.06rem}
.afirmacao .envolve{margin:.2rem 0 .4rem}
.afirmacao .mais{margin-top:.3rem}
.afirmacao .fontes{margin:.4rem 0;padding-left:1.1rem;font-size:.88rem}
.afirmacao .casos{font-size:.88rem;margin:.3rem 0}
.resposta{font-size:.95rem;margin:.7rem 0;padding:.1rem 0 .1rem .9rem;border-left:2px solid var(--borda-forte);color:var(--texto)}
.resposta .rotulo{display:block;font-family:var(--sans);font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--texto-suave);margin-bottom:.15rem}
.resposta small{display:block;margin-top:.3rem}
/* linha do tempo horizontal */
.linha{margin:1rem calc(-1 * var(--margem)) 0;padding:0 var(--margem)}
.linha-cabecalho{display:flex;justify-content:space-between;align-items:baseline;gap:1rem}
.linha-nav{display:flex;gap:.4rem}
.linha-nav button{padding:.25rem .7rem}
.trilho{position:relative;display:flex;gap:1.5rem;overflow-x:auto;scroll-snap-type:x proximity;scroll-padding-inline-start:var(--margem);padding:2.6rem 0 1rem;margin:0 calc(-1 * var(--margem));padding-inline:var(--margem);scrollbar-width:thin;outline:none;cursor:grab}
.trilho.arrastando,.trilho.rolando{scroll-snap-type:none}
.trilho.arrastando{cursor:grabbing;user-select:none}
.trilho:focus-visible{box-shadow:inset 0 0 0 1px var(--borda-forte)}
.marco{flex:0 0 clamp(13rem,17vw,16rem);position:relative;padding:1.1rem 0 0;scroll-snap-align:start;cursor:pointer;border-radius:4px}
.marco::before{content:"";position:absolute;top:.3rem;left:0;right:-1.5rem;height:1px;background:var(--borda)}
.marco:last-child::before{right:0}
.marco::after{content:"";position:absolute;top:0;left:0;width:.6rem;height:.6rem;border-radius:50%;background:var(--cor,var(--borda-forte));transition:transform .15s}
.marco:hover::after,.marco.aberto::after{transform:scale(1.5)}
.marco.inicio-mes .mes,.marco.inicio-mes header::before{content:attr(data-mes)}
.marco.inicio-mes{margin-left:.25rem}
.marco.inicio-mes header::before{position:absolute;top:-1.5rem;left:0;font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--texto-suave);white-space:nowrap;content:attr(data-mes)}
.marco header{position:static;font-size:.8rem;color:var(--texto-suave);display:flex;gap:.6rem;align-items:center}
.marco header time{font-variant-numeric:tabular-nums;color:var(--texto)}
.marco .frase{font-family:var(--serifa);font-size:.95rem;line-height:1.45;margin:.35rem 0 .4rem;color:var(--texto)}
.marco .quem{margin:0;font-size:.8rem;line-height:1.7}
.marco .quem a.entidade{margin-right:.5rem}
.marco.aberto .frase{color:var(--texto)}
.marco.aberto{box-shadow:inset 3px 0 0 var(--cor,var(--borda-forte));padding-left:.7rem}
.marco[data-natureza=fato]{--cor:var(--fato)}.marco[data-natureza=decisao]{--cor:var(--decisao)}
.marco[data-natureza=alegacao]{--cor:var(--alegacao)}.marco[data-natureza=desmentido]{--cor:var(--desmentido)}
.linha-detalhe{position:relative;border-top:1px solid var(--borda);margin-top:.5rem;padding:.25rem 0 0}
.linha-detalhe .fechar{position:absolute;top:.6rem;right:0;border:none;font-size:1.1rem;padding:.1rem .5rem}
.linha-detalhe .afirmacao{max-width:46rem;margin:1rem 0 .5rem}
.marco.filtrado{display:none}
.filtros-linha{display:flex;flex-wrap:wrap;gap:.6rem 1.25rem;align-items:center;font-size:.85rem;color:var(--texto-suave);margin:.5rem 0 0;padding:.6rem 0;border-top:1px solid var(--borda)}
.filtros-linha fieldset{border:none;padding:0;margin:0;display:flex;gap:.9rem;align-items:center}
.filtros-linha legend{float:left;margin-right:.4rem;padding:0}
.filtros-linha label{display:flex;gap:.35rem;align-items:center;white-space:nowrap}
.filtros-linha label.natureza{text-transform:none;letter-spacing:0;font-size:.85rem;cursor:pointer}
.filtros-linha label.natureza::before{display:none}
.filtros-linha input[type=checkbox]{accent-color:var(--cor,var(--texto));margin:0}
.filtros-linha select{max-width:16rem}
.filtros-linha input[type=month]{font:inherit;font-size:.85rem;background:transparent;color:var(--texto);border:1px solid var(--borda-forte);border-radius:999px;padding:.2rem .6rem}
/* introdução */
.introducao{display:grid;grid-template-columns:minmax(0,1fr);gap:2.5rem;margin:1.5rem 0 0;padding-top:1.5rem;border-top:1px solid var(--borda)}
@media (min-width:64rem){.introducao{grid-template-columns:minmax(0,1fr) 17rem;justify-content:space-between;gap:5rem}.introducao .intro-texto{max-width:70rem}.intro-lateral{position:sticky;top:5rem;align-self:start}}
.intro-texto h2{font-size:1.9rem;margin:0 0 1rem}
.intro-texto h3{font-size:1.25rem;margin:2rem 0 .5rem}
.intro-texto p{font-family:var(--serifa);font-size:1.08rem}
.intro-texto h2 + p{font-size:1.18rem;line-height:1.55}
.ver-linha{font-family:var(--sans);font-weight:400;font-size:.8rem;letter-spacing:0;margin-left:.6rem;text-decoration:none;color:var(--texto-suave);white-space:nowrap}
.ver-linha:hover{color:var(--texto)}
.capitulos h3,.como-ler h3{font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;color:var(--texto-suave);font-family:var(--sans);font-weight:400;margin:0 0 .5rem}
.capitulos ol{margin:0 0 2rem;padding-left:0;list-style:none;font-size:.92rem}
.capitulos li{margin:.3rem 0}
.capitulos a{color:var(--texto);text-decoration:none}
.capitulos a:hover{text-decoration:underline}
.como-ler p{font-size:.88rem;color:var(--texto-suave);margin:.5rem 0}
/* quem é quem */
.quem-e-quem{margin-top:1rem}
.quem-e-quem .grupos{display:grid;grid-template-columns:repeat(auto-fill,minmax(17rem,1fr));gap:1.5rem 2.5rem}
.quem-e-quem h3{margin:.5rem 0}
.quem-e-quem ul{list-style:none;padding:0;margin:0}
.quem-e-quem li{margin:.5rem 0;font-size:.92rem;line-height:1.45}
.quem-e-quem li small{margin-left:.3rem}
.quem-e-quem .desc{display:block;color:var(--texto-suave);font-size:.85rem}
/* árvore do caso no tempo */
.arvore-tempo{margin:1rem 0 3rem}
.arvore-tempo-rolagem{overflow-x:auto;margin:0 calc(-1 * var(--margem));padding-inline:var(--margem)}
.arvore-tempo svg{display:block;width:100%;height:auto;font-family:var(--sans)}
.arvore-tempo .mes-linha{stroke:var(--borda);stroke-width:1}
.arvore-tempo text.mes{fill:var(--texto-suave);font-size:10.5px;letter-spacing:.05em;text-transform:uppercase}
.arvore-tempo .trilha{stroke:var(--cor);stroke-width:2.5;stroke-linecap:round}
.arvore-tempo .bifurcacao{fill:none;stroke:var(--cor);stroke-width:2}
.arvore-tempo .fraca{stroke-dasharray:2 5;opacity:.6}
.arvore-tempo .no-ramo{fill:var(--fundo);stroke:var(--cor);stroke-width:2.5}
.arvore-tempo .ponto{stroke:var(--fundo);stroke-width:1.5}
.arvore-tempo .ponto.secundario{fill:var(--fundo);stroke:var(--cor)}
.arvore-tempo .ponto.natureza-fato{fill:var(--fato)}.arvore-tempo .ponto.natureza-decisao{fill:var(--decisao)}.arvore-tempo .ponto.natureza-alegacao{fill:var(--alegacao)}.arvore-tempo .ponto.natureza-desmentido{fill:var(--desmentido)}.arvore-tempo .ponto.natureza-arquivado{fill:var(--arquivado)}
.arvore-tempo .ponto.secundario.natureza-fato,.arvore-tempo .ponto.secundario.natureza-decisao,.arvore-tempo .ponto.secundario.natureza-alegacao{fill:var(--fundo)}
.arvore-tempo text.titulo-ramo{fill:var(--cor);font-family:var(--serifa);font-weight:600;font-size:13.5px}
.arvore-tempo text.titulo-ramo .meta{fill:var(--texto-suave);font-family:var(--sans);font-weight:400;font-size:11px}
.arvore-tempo text.texto{fill:var(--texto);font-size:12.5px}
.arvore-tempo text.texto .data{fill:var(--texto-suave);font-variant-numeric:tabular-nums}
.arvore-tempo text.texto .nat{font-size:9.5px;letter-spacing:.06em;text-transform:uppercase}
.arvore-tempo .nat.natureza-fato{fill:var(--fato)}.arvore-tempo .nat.natureza-decisao{fill:var(--decisao)}.arvore-tempo .nat.natureza-alegacao{fill:var(--alegacao)}.arvore-tempo .nat.natureza-desmentido{fill:var(--desmentido)}
.arvore-tempo .fundo-linha{fill:transparent}
.arvore-tempo g:hover .fundo-linha{fill:var(--superficie)}
.arvore-tempo a:hover text{fill:var(--link)}
.ramos-legenda{columns:2 22rem;column-gap:3rem;padding-left:0;list-style:none;margin:1rem 0 0;font-size:.9rem}
.ramos-legenda li{break-inside:avoid;margin:.25rem 0}
.ramos-legenda .coluna{display:inline-block;width:1.4rem;height:1.4rem;line-height:1.4rem;text-align:center;border-radius:50%;border:2px solid var(--cor);color:var(--cor);font-size:.72rem;margin-right:.4rem}
.ramos-legenda a{color:var(--texto);text-decoration:none}.ramos-legenda a:hover{text-decoration:underline}
.intro-curta{color:var(--texto-suave);margin:.25rem 0 1rem}
.intro-texto .depois{margin-top:2.5rem;font-family:var(--sans)}
.botao{display:inline-block;border:1px solid var(--texto);border-radius:999px;padding:.45rem 1rem;text-decoration:none;color:var(--texto);margin:0 .75rem .5rem 0;font-size:.92rem}
.botao:hover{background:var(--texto);color:var(--fundo)}
.atalhos h3{font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;color:var(--texto-suave);font-family:var(--sans);font-weight:400;margin:0 0 .5rem}
.atalhos ul{list-style:none;padding:0;margin:0 0 2rem;font-size:.92rem}
.atalhos li{margin:.35rem 0}
.atalhos a{color:var(--texto)}
.atalhos small{display:block}
/* placeholder de imagem */
.placeholder{display:flex;align-items:flex-end;height:6rem;margin:.75rem 0;border-radius:3px;background:color-mix(in srgb,var(--cor) 9%,var(--superficie));padding:.5rem .75rem;color:var(--cor);font-size:.72rem;letter-spacing:.06em;text-transform:uppercase}
.placeholder::after{content:attr(data-nome)}
figure{margin:.75rem 0}figure img{max-width:100%;border-radius:3px;display:block}figcaption{font-size:.8rem;color:var(--texto-suave);margin-top:.3rem}
.card figure{margin:0}.card figure img{width:100%;height:11rem;object-fit:cover}
/* casos */
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(19rem,1fr));gap:2.5rem 2rem;padding:0;list-style:none;margin:1.5rem 0}
.card>a{text-decoration:none;color:inherit;display:block}
.card .placeholder{height:7rem;margin:0}
.card .corpo{padding:.9rem 0 0}
.card h3{margin:.2rem 0 .35rem;font-size:1.2rem}
.card .corpo p{margin:0;font-size:1rem;color:var(--texto-suave)}
.card>a:hover h3{text-decoration:underline;text-decoration-color:var(--borda-forte)}
.anterior-proximo{display:flex;justify-content:space-between;gap:2rem;margin:3rem 0 0;padding-top:1.25rem;border-top:1px solid var(--borda);font-size:.92rem}
.anterior-proximo a{text-decoration:none;color:var(--texto);max-width:45%}
.anterior-proximo a:hover{text-decoration:underline}
.anterior-proximo small{display:block}
.anterior-proximo .proximo{text-align:right;margin-left:auto}
/* grafo */
.grafo-topo{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;flex-wrap:wrap}
.controles-grafo{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;font-size:.88rem}
.controles-grafo label{display:flex;gap:.4rem;align-items:center;color:var(--texto-suave)}
.grafo-area{position:relative;margin:.75rem calc(-1 * var(--margem)) 0}
#grafo{display:block;width:100%;height:calc(100vh - 14rem);min-height:28rem;background:var(--fundo);cursor:grab}
#grafo:active{cursor:grabbing}
#grafo .no{cursor:pointer}
#grafo .no circle{transition:opacity .2s}
#grafo .rotulos text{font-family:"Avenir Next Condensed","Roboto Condensed","Arial Narrow","Helvetica Neue",Arial,sans-serif;font-size:10.5px;letter-spacing:.01em;fill:var(--texto);pointer-events:none;transition:opacity .2s}
#grafo .rotulos text.fora{paint-order:stroke;stroke:var(--fundo);stroke-width:2px;stroke-linejoin:round}
#grafo .rotulos text.dentro{fill:#fff;font-weight:600}
#grafo .aresta{stroke:var(--texto-suave);stroke-opacity:.3;transition:opacity .2s,stroke-opacity .2s}
#grafo .apagado{opacity:.1}
#grafo .no.aceso circle{stroke:var(--texto);stroke-width:1.5px}
#grafo .rotulos text.aceso{font-weight:700}
#grafo .aresta.acesa{stroke-opacity:.9}
#grafo-painel,.grafo-ajustes{position:absolute;top:1rem;background:var(--superficie);border:1px solid var(--borda);border-radius:6px;padding:.9rem 1.1rem;font-size:.88rem;box-shadow:0 6px 24px rgba(0,0,0,.06)}
#grafo-painel{right:var(--margem);width:17rem;max-width:calc(100% - 2*var(--margem))}
#grafo-painel h3{margin:0 0 .2rem}
#grafo-painel ul{margin:.5rem 0 0;padding-left:1.1rem}
#grafo-painel .fechar{position:absolute;top:.4rem;right:.5rem;border:none;padding:.1rem .4rem;font-size:1rem}
.grafo-ajustes{left:var(--margem);width:16rem;max-width:calc(100% - 2*var(--margem))}
.grafo-ajustes h3{font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--texto-suave);font-family:var(--sans);font-weight:400;margin:.9rem 0 .4rem}
.grafo-ajustes h3:first-child{margin-top:0}
.grafo-ajustes label{display:block;color:var(--texto-suave);font-size:.82rem;margin:.35rem 0}
.grafo-ajustes label.campo{display:flex;gap:.4rem;align-items:center}
.grafo-ajustes input[type=search]{flex:1;min-width:0;border-radius:4px;padding:.2rem .5rem}
.grafo-ajustes input[type=range]{display:block;width:100%;margin:.15rem 0 0;accent-color:var(--texto)}
.legenda{display:flex;gap:.5rem 1rem;flex-wrap:wrap;font-size:.82rem;margin:.75rem 0;color:var(--texto-suave)}
.legenda i{display:inline-block;width:.6rem;height:.6rem;border-radius:50%;background:var(--cor);vertical-align:middle;margin-right:.4rem}
.grupo-legenda{border:none;padding:.1rem .3rem;border-radius:4px;color:var(--texto-suave);font-size:.82rem}
.grupo-legenda:hover{color:var(--texto)}
.grupo-legenda[aria-pressed=false]{opacity:.4;text-decoration:line-through}
/* grafo local */
.grafo-local{display:block;width:100%;max-width:22rem;margin:.25rem 0 .5rem}
.grafo-local .arestas line{stroke:var(--borda-forte);stroke-opacity:.7}
.grafo-local text{font-size:11px;fill:var(--texto);paint-order:stroke;stroke:var(--fundo);stroke-width:3px}
.grafo-local a:hover text{fill:var(--link)}
/* árvore */
.arvore{columns:2 28rem;column-gap:4rem;margin-top:1.5rem}
.arvore>details{break-inside:avoid;margin:0 0 1.75rem}
.arvore details details{margin:.35rem 0 .35rem .5rem;padding-left:1rem;border-left:1px solid var(--borda)}
.arvore summary{padding:.15rem 0;color:var(--texto);font-size:.95rem}
.arvore summary.divisao-titulo{font-family:var(--serifa);font-size:1.25rem;font-weight:600;color:var(--cor)}
.arvore ul{margin:.25rem 0;padding-left:1.2rem}
.afirmacao-curta{margin:.4rem 0;font-size:.92rem}
.afirmacao-curta time{font-variant-numeric:tabular-nums}
/* fontes */
.lista-fontes{list-style:none;padding:0;margin:.5rem 0 2rem}
.lista-fontes li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.25rem 2rem;padding:.6rem 0;border-top:1px solid var(--borda);font-size:.95rem}
.lista-fontes li small{display:block}
.lista-fontes .uso{font-variant-numeric:tabular-nums;color:var(--texto-suave);white-space:nowrap}
/* busca */
.resultados{background:var(--superficie);border:1px solid var(--borda);border-radius:6px;padding:.75rem 1.25rem 1rem;margin:1.25rem 0 0}
.resultados h3{margin:.75rem 0 .25rem}
.resultados ul{margin:.25rem 0;padding-left:1.2rem}
.resultados li{margin:.3rem 0}
.resultados .trecho{color:var(--texto-suave);font-size:.9rem;font-family:var(--serifa)}
.cabecalho-busca{display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap}
/* páginas de aprofundamento: coluna de leitura + lateral */
.duas-colunas{display:grid;grid-template-columns:minmax(0,1fr);gap:3rem}
@media (min-width:64rem){.duas-colunas{grid-template-columns:minmax(0,1fr) 20rem;justify-content:space-between;gap:5rem}.duas-colunas .prosa{max-width:70rem}.lateral{position:sticky;top:5rem;align-self:start}}
.lateral h2{font-size:1.05rem;margin:0 0 .5rem}
.lateral section{margin-bottom:1.75rem}
.lateral ul{margin:.25rem 0;padding-left:1.1rem;font-size:.92rem}
.ligacoes .grupo{margin:.5rem 0 .9rem}
.ligacoes ul{margin:.2rem 0 0;padding-left:1.1rem}
@media (max-width:40rem){
  .controles{margin-left:0;width:100%}
  .busca,.busca input{width:100%}
  .trilho .afirmacao{flex-basis:85vw}
  #grafo{height:60vh}
  .numeros{gap:1.5rem}
}
@media print{
  .topo .controles,.resultados,.arvore button,.linha-nav,.controles-grafo,footer a{display:none}
  .trilho{display:block}
  .trilho .afirmacao{margin:1.5rem 0}
}
`;

// ---------- scripts ----------
// Tema: aplicado antes da pintura para não piscar. Sem localStorage (regra do projeto); o estado
// vive na query string e é carregado para os links internos pelo script de estado.
const SCRIPT_TEMA_CEDO = `
(function(){var t=new URLSearchParams(location.search).get('tema');if(t==='claro'||t==='escuro')document.documentElement.dataset.tema=t;})();`;

// Estado de navegação (divisão e tema): filtro por divisão, botão de tema e propagação dos
// parâmetros para todos os links internos, para que a escolha sobreviva à navegação.
const SCRIPT_ESTADO = `
(function(){
  var sel=document.getElementById('filtro-divisao');
  var botaoTema=document.getElementById('tema');
  var params=new URLSearchParams(location.search);
  sel.value=params.get('divisao')||'';
  if(sel.value!==(params.get('divisao')||''))sel.value='';
  function estado(){var p=new URLSearchParams();if(sel.value)p.set('divisao',sel.value);var t=document.documentElement.dataset.tema;if(t)p.set('tema',t);var s=p.toString();return s?'?'+s:'';}
  function gravar(){history.replaceState(null,'',location.pathname+estado()+location.hash);}
  function aplicarFiltro(){
    var d=sel.value;
    document.querySelectorAll('[data-divisoes]').forEach(function(el){el.hidden=!!d&&el.dataset.divisoes.split(' ').indexOf(d)<0;});
    var cont=document.getElementById('contagem-filtro');
    if(cont){var tot=document.querySelectorAll('[data-divisoes]').length,vis=document.querySelectorAll('[data-divisoes]:not([hidden])').length;cont.textContent=d&&tot?vis+' de '+tot:'';}
    document.dispatchEvent(new CustomEvent('filtro-divisao',{detail:d}));
  }
  function temaEfetivo(){return document.documentElement.dataset.tema||(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'escuro':'claro');}
  function rotularTema(){botaoTema.textContent=temaEfetivo()==='escuro'?'☀':'☾';botaoTema.title=temaEfetivo()==='escuro'?'Mudar para o tema claro':'Mudar para o tema escuro';}
  botaoTema.addEventListener('click',function(){
    document.documentElement.dataset.tema=temaEfetivo()==='escuro'?'claro':'escuro';
    gravar();rotularTema();
    document.dispatchEvent(new CustomEvent('tema-mudou'));
  });
  sel.addEventListener('change',function(){gravar();aplicarFiltro();});
  document.addEventListener('click',function(ev){
    var a=ev.target.closest('a[href]');if(!a)return;
    var href=a.getAttribute('href');
    if(/^(https?:|mailto:|#)/.test(href)||a.target==='_blank')return;
    var partes=href.split('#'),base=partes[0].split('?'),u=new URLSearchParams(base[1]||'');
    if(sel.value)u.set('divisao',sel.value);else u.delete('divisao');
    var t=document.documentElement.dataset.tema;if(t)u.set('tema',t);else u.delete('tema');
    var q=u.toString();
    a.setAttribute('href',base[0]+(q?'?'+q:'')+(partes[1]?'#'+partes[1]:''));
  },true);
  rotularTema();
  aplicarFiltro();
})();`;

const SCRIPT_BUSCA = `
(function(){
  var input=document.querySelector('.busca input');
  var painel=document.getElementById('resultados-busca');
  var sel=document.getElementById('filtro-divisao');
  var RAIZ=input.dataset.raiz;
  var TIPOS=[['entidade','Entidades'],['caso','Casos'],['afirmacao','Afirmações']];
  function norm(s){return (s||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');}
  function esc(s){return s.replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function buscar(){
    var q=input.value.trim();
    if(q.length<2||!window.INDICE_BUSCA){painel.hidden=true;painel.innerHTML='';return;}
    var termos=norm(q).split(/\\s+/).filter(Boolean);
    var d=sel.value;
    var achados=[];
    window.INDICE_BUSCA.forEach(function(it){
      if(d&&it.divisoes.indexOf(d)<0)return;
      var titulo=norm(it.titulo),extra=norm(it.extra),texto=norm(it.texto);
      var pontos=0;
      for(var i=0;i<termos.length;i++){
        var t=termos[i];
        if(titulo.indexOf(t)>=0)pontos+=3;else if(extra.indexOf(t)>=0)pontos+=2;else if(texto.indexOf(t)>=0)pontos+=1;else return;
      }
      achados.push([pontos,it]);
    });
    achados.sort(function(a,b){return b[0]-a[0];});
    var html='';
    TIPOS.forEach(function(tp){
      var lista=achados.filter(function(x){return x[1].t===tp[0];});
      if(!lista.length)return;
      html+='<h3>'+tp[1]+' <small>('+lista.length+')</small></h3><ul>';
      lista.forEach(function(x){var it=x[1];
        html+='<li><a href="'+RAIZ+esc(it.url)+'">'+esc(it.titulo)+'</a>'+(it.t==='entidade'?'':' — <span class="trecho">'+esc(it.texto.length>160?it.texto.slice(0,160)+'…':it.texto)+'</span>')+'</li>';
      });
      html+='</ul>';
    });
    painel.innerHTML='<div class="cabecalho-busca"><strong>'+achados.length+' resultado'+(achados.length===1?'':'s')+' para “'+esc(q)+'”'+(d?' na divisão selecionada':'')+'</strong> <button type="button" id="limpar-busca">Limpar</button></div>'+(html||'<p class="vazio">Nenhum resultado.</p>');
    painel.hidden=false;
    document.getElementById('limpar-busca').addEventListener('click',function(){input.value='';buscar();input.focus();});
  }
  var timer;
  input.addEventListener('input',function(){clearTimeout(timer);timer=setTimeout(buscar,120);});
  input.addEventListener('keydown',function(ev){if(ev.key==='Escape'){input.value='';buscar();}});
  document.addEventListener('filtro-divisao',buscar);
  var s=document.getElementById('indice-busca');
  if(s)s.addEventListener('load',buscar);
})();`;

const SCRIPT_LINHA = `
(function(){
  var trilho=document.querySelector('.trilho');
  if(!trilho)return;
  var pad=function(){return parseFloat(getComputedStyle(trilho).paddingLeft)||0;};
  var cartoes=function(){return Array.prototype.slice.call(trilho.querySelectorAll('.marco:not([hidden]):not(.filtrado)'));};
  var anim=null;
  function rolarPara(alvo){
    if(anim)cancelAnimationFrame(anim);
    var ini=trilho.scrollLeft,dist=alvo-ini,t0=performance.now();
    trilho.classList.add('rolando');
    var fim=function(){anim=null;trilho.classList.remove('rolando');};
    (function passo(t){
      var p=Math.min(1,(t-t0)/380),e=1-Math.pow(1-p,3);
      trilho.scrollLeft=ini+dist*e;
      if(p<1)anim=requestAnimationFrame(passo);else fim();
    })(t0);
    setTimeout(function(){if(anim){cancelAnimationFrame(anim);trilho.scrollLeft=alvo;fim();}},450);
  }
  function proximo(dir){
    var atual=trilho.scrollLeft,p=pad(),lista=cartoes(),alvo=null;
    if(dir>0){for(var i=0;i<lista.length;i++){var x=lista[i].offsetLeft-p;if(x>atual+4){alvo=x;break;}}}
    else{for(var j=lista.length-1;j>=0;j--){var y=lista[j].offsetLeft-p;if(y<atual-4){alvo=y;break;}}if(alvo===null)alvo=0;}
    if(alvo!==null)rolarPara(alvo);
  }
  document.querySelectorAll('.linha-nav button').forEach(function(b){b.addEventListener('click',function(){proximo(Number(b.dataset.dir));});});
  trilho.addEventListener('keydown',function(ev){
    if(ev.key==='ArrowRight'){proximo(1);ev.preventDefault();}
    if(ev.key==='ArrowLeft'){proximo(-1);ev.preventDefault();}
  });
  trilho.addEventListener('wheel',function(ev){
    if(Math.abs(ev.deltaY)>Math.abs(ev.deltaX)&&!ev.shiftKey){trilho.scrollLeft+=ev.deltaY;ev.preventDefault();}
  },{passive:false});
  var x0=null,s0=0,moveu=false;
  trilho.addEventListener('pointerdown',function(ev){if(ev.button!==0||ev.target.closest('a,button,summary'))return;x0=ev.clientX;s0=trilho.scrollLeft;moveu=false;trilho.classList.add('arrastando');});
  window.addEventListener('pointermove',function(ev){if(x0===null)return;var dx=ev.clientX-x0;if(Math.abs(dx)>4)moveu=true;trilho.scrollLeft=s0-dx;});
  window.addEventListener('pointerup',function(){x0=null;trilho.classList.remove('arrastando');});
  trilho.addEventListener('click',function(ev){if(moveu){ev.preventDefault();ev.stopPropagation();moveu=false;}},true);
  var painel=document.getElementById('linha-detalhe');
  function abrir(id){
    var jaAberto=trilho.querySelector('.marco.aberto');
    trilho.querySelectorAll('.marco').forEach(function(m){m.classList.remove('aberto');m.setAttribute('aria-expanded','false');});
    painel.querySelectorAll('.detalhe-item').forEach(function(d){d.hidden=true;});
    if(!id||(jaAberto&&jaAberto.dataset.id===id)){painel.hidden=true;return;}
    var m=trilho.querySelector('.marco[data-id="'+id+'"]'),d=painel.querySelector('.detalhe-item[data-id="'+id+'"]');
    if(!m||!d)return;
    m.classList.add('aberto');m.setAttribute('aria-expanded','true');d.hidden=false;painel.hidden=false;
  }
  trilho.addEventListener('click',function(ev){
    if(ev.target.closest('a'))return;
    var m=ev.target.closest('.marco');if(m)abrir(m.dataset.id);
  });
  trilho.addEventListener('keydown',function(ev){
    if(ev.key==='Enter'||ev.key===' '){var m=ev.target.closest('.marco');if(m){abrir(m.dataset.id);ev.preventDefault();}}
  });
  painel.querySelector('.fechar').addEventListener('click',function(){abrir(null);});
  document.addEventListener('filtro-divisao',function(){var a=trilho.querySelector('.marco.aberto');if(a&&a.hidden)abrir(null);});
  // Filtros da linha do tempo: natureza, caso, entidade e período. Combinam com o filtro por divisão
  // (que usa o atributo hidden); estes usam a classe .filtrado. Estado na query string.
  var form=document.querySelector('.filtros-linha');
  var selCaso=document.getElementById('filtro-caso'),selEnt=document.getElementById('filtro-entidade'),de=document.getElementById('filtro-de'),ate=document.getElementById('filtro-ate');
  function naturezasAtivas(){return Array.prototype.slice.call(form.querySelectorAll('input[name=natureza]:checked')).map(function(i){return i.value;});}
  function aplicarFiltros(){
    var nats=naturezasAtivas(),c=selCaso.value,e=selEnt.value,d0=de.value,d1=ate.value;
    var todos=Array.prototype.slice.call(trilho.querySelectorAll('.marco')),vis=0,mesVisto={};
    todos.forEach(function(m){
      var ok=nats.indexOf(m.dataset.natureza)>=0
        &&(!c||m.dataset.casos.split(' ').indexOf(c)>=0)
        &&(!e||m.dataset.entidades.split(' ').indexOf(e)>=0)
        &&(!d0||m.dataset.data.slice(0,7)>=d0)
        &&(!d1||m.dataset.data.slice(0,7)<=d1);
      m.classList.toggle('filtrado',!ok);
      var mostra=ok&&!m.hidden;
      if(mostra){vis++;m.classList.toggle('inicio-mes',!mesVisto[m.dataset.mes]);mesVisto[m.dataset.mes]=true;}
    });
    document.getElementById('contagem-linha').textContent=vis===todos.length?'':vis+' de '+todos.length;
    document.getElementById('linha-vazia').hidden=vis>0;
    var a=trilho.querySelector('.marco.aberto');if(a&&(a.hidden||a.classList.contains('filtrado')))abrir(null);
    var u=new URL(location.href);
    [['nat',nats.length===form.querySelectorAll('input[name=natureza]').length?'':nats.join(',')],['caso',c],['ent',e],['de',d0],['ate',d1]].forEach(function(par){if(par[1])u.searchParams.set(par[0],par[1]);else u.searchParams.delete(par[0]);});
    history.replaceState(null,'',u);
  }
  form.addEventListener('change',aplicarFiltros);
  document.getElementById('limpar-filtros').addEventListener('click',function(){form.querySelectorAll('input[name=natureza]').forEach(function(i){i.checked=true;});selCaso.value='';selEnt.value='';de.value='';ate.value='';aplicarFiltros();});
  document.addEventListener('filtro-divisao',aplicarFiltros);
  document.querySelectorAll('.ver-linha').forEach(function(a){a.addEventListener('click',function(){de.value=a.dataset.de||'';ate.value=a.dataset.ate||'';aplicarFiltros();trilho.scrollLeft=0;});});
  (function lerUrl(){
    var q=new URLSearchParams(location.search);
    if(q.get('nat')){var n=q.get('nat').split(',');form.querySelectorAll('input[name=natureza]').forEach(function(i){i.checked=n.indexOf(i.value)>=0;});}
    if(q.get('caso'))selCaso.value=q.get('caso');if(q.get('ent'))selEnt.value=q.get('ent');if(q.get('de'))de.value=q.get('de');if(q.get('ate'))ate.value=q.get('ate');
  })();
  aplicarFiltros();
  if(location.hash){var alvo=trilho.querySelector('.marco[data-id="'+location.hash.slice(1)+'"]');if(alvo){abrir(alvo.dataset.id);alvo.scrollIntoView({inline:'start',block:'nearest'});}}
})();`;

const VISUALIZACOES = [
  ["inicio", "Início", "index.html"],
  ["linha-do-tempo", "Linha do tempo", "linha-do-tempo.html"],
  ["casos", "Casos", "casos.html"],
  ["grafo", "Grafo", "grafo.html"],
  ["arvore", "Árvore", "arvore.html"],
];
const SECUNDARIAS = [
  ["quem-e-quem", "Quem é quem", "quem-e-quem.html"],
  ["sobre", "Sobre", "sobre.html"],
  ["fontes", "Fontes", "fontes.html"],
];

const pagina = ({ titulo, corpo, profundidade, visualizacao = null, extraHead = "", extraScript = "" }) => {
  const raiz = raizDe(profundidade);
  const nav = (lista) => lista.map(([id, nome, arquivo]) =>
    `<a href="${raiz}${arquivo}"${visualizacao === id ? ' aria-current="page"' : ""}>${nome}</a>`).join("");
  const opcoes = Object.entries(DIVISOES).map(([id, d]) => `<option value="${id}">${h(d.nome)}</option>`).join("");
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(titulo)} · Caso Master</title>
<script>${SCRIPT_TEMA_CEDO}</script>
<style>${CSS}</style>
<script defer id="indice-busca" src="${raiz}indice-busca.js"></script>
${extraHead}
</head>
<body>
<header class="topo">
  <a class="marca" href="${raiz}index.html">Caso Master</a>
  <nav class="visualizacoes" aria-label="Visualização">${nav(VISUALIZACOES)}</nav>
  <nav class="secundaria" aria-label="Sobre o projeto">${nav(SECUNDARIAS)}</nav>
  <div class="controles">
    <label>Divisão
      <select id="filtro-divisao"><option value="">Todas</option>${opcoes}</select>
    </label>
    <small id="contagem-filtro"></small>
    <form class="busca" role="search" onsubmit="return false">
      <input type="search" name="q" placeholder="Buscar entidades, casos, afirmações" aria-label="Buscar" autocomplete="off" data-raiz="${raiz}">
    </form>
    <button type="button" id="tema" aria-label="Alternar tema">◐</button>
  </div>
</header>
<p class="aviso" role="note">${h(AVISO)}</p>
<section id="resultados-busca" class="resultados" aria-live="polite" hidden></section>
<main>
${corpo}
</main>
<footer><p>${h(AVISO)} · <a href="${raiz}index.html">Início</a> · <a href="${raiz}linha-do-tempo.html">Linha do tempo</a> · <a href="${raiz}quem-e-quem.html">Quem é quem</a> · <a href="${raiz}sobre.html">Sobre</a> · <a href="${raiz}fontes.html">Fontes</a></p></footer>
<script>${SCRIPT_ESTADO}</script>
<script>${SCRIPT_BUSCA}</script>
<script>${SCRIPT_LINHA}</script>
${extraScript}
</body>
</html>
`;
};

// ---------- página inicial: abertura curta, números e linha do tempo ----------
const numeros = () => {
  const afrConferidas = afirmacoes.filter(conferida).length;
  return `
  <dl class="numeros">
    <div><dt>afirmações</dt><dd>${afirmacoes.length}<small>${afrConferidas} conferidas</small></dd></div>
    <div><dt>casos</dt><dd>${casos.length}</dd></div>
    <div><dt>entidades</dt><dd>${entidades.length}</dd></div>
    <div><dt>fontes</dt><dd>${fontes.length}</dd></div>
  </dl>`;
};

// Página inicial: só a introdução, com índice de capítulos e atalhos para as visualizações.
const paginaInicial = () => {
  const raiz = raizDe(0);
  const capitulos = introducao.capitulos.map((c) => `<li><a href="#${h(c.id)}">${h(c.titulo)}</a></li>`).join("");
  return pagina({
    titulo: "Início",
    profundidade: 0,
    visualizacao: "inicio",
    corpo: `
<section class="abertura">
  <p class="lede">${primeiroParagrafo} <a href="${raiz}sobre.html">Sobre o projeto →</a></p>
  ${numeros()}
</section>
<section class="introducao" id="entenda">
  <div class="intro-texto prosa">${introducao.html}
    <p class="depois"><a class="botao" href="${raiz}linha-do-tempo.html">Explorar a linha do tempo →</a> <a class="botao" href="${raiz}quem-e-quem.html">Quem é quem →</a></p>
  </div>
  <aside class="intro-lateral">
    <nav class="capitulos" aria-label="Capítulos"><h3>Capítulos</h3><ol>${capitulos}</ol></nav>
    <nav class="atalhos" aria-label="Explorar"><h3>Explorar</h3><ul>
      <li><a href="${raiz}linha-do-tempo.html">Linha do tempo</a> <small>todos os registros, com filtros</small></li>
      <li><a href="${raiz}casos.html">Casos</a> <small>os episódios, um a um</small></li>
      <li><a href="${raiz}grafo.html">Grafo</a> <small>quem se liga a quem</small></li>
      <li><a href="${raiz}arvore.html">Árvore</a> <small>de onde partiu, para onde foi</small></li>
      <li><a href="${raiz}quem-e-quem.html">Quem é quem</a> <small>as ${entidades.length} entidades</small></li>
    </ul></nav>
    <div class="como-ler">
      <h3>Como ler</h3>
      <p>${rotuloNatureza("fato")} aconteceu e é verificável. ${rotuloNatureza("decisao")} ato formal de um órgão. ${rotuloNatureza("alegacao")} alguém afirma, ainda não está estabelecido; vem sempre com quem alega e com a resposta do citado. ${rotuloNatureza("desmentido")} foi refutado e permanece registrado.</p>
      <p><span class="selo nao-conferida">não conferida</span> marca o que o agente registrou a partir das fontes e ainda não passou por revisão humana.</p>
    </div>
  </aside>
</section>`,
  });
};

const paginaLinhaDoTempo = () => {
  const raiz = raizDe(0);
  const cronologia = [...afirmacoes].sort(porData);
  return pagina({
    titulo: "Linha do tempo",
    profundidade: 0,
    visualizacao: "linha-do-tempo",
    corpo: `
<p class="prosa intro-curta">Todos os registros em ordem cronológica. Use os filtros para isolar um caso, uma pessoa, um tipo de registro ou um período. Se está chegando agora, comece pela <a href="${raiz}index.html">introdução</a>.</p>
${renderLinhaDoTempo(cronologia, raiz)}`,
  });
};

const paginaQuemEQuem = () => {
  const raiz = raizDe(0);
  const contagem = new Map(entidades.map((e) => [e.id, afirmacoesDaEntidade(e.id).length]));
  const grupos = Object.entries(DIVISOES).map(([divId]) => {
    const ents = entidades.filter((e) => e.grupo === divId).sort((a, b) => contagem.get(b.id) - contagem.get(a.id) || a.nome.localeCompare(b.nome));
    return ents.length ? `
    <div class="grupo" data-divisoes="${divId}">
      <h3>${rotuloDivisao(divId)} <small>${ents.length}</small></h3>
      <ul>${ents.map((e) => `<li>${linkEntidade(e.id, raiz)} <small>${plural(contagem.get(e.id), "afirmação", "afirmações")}</small>${e.descricao ? `<span class="desc">${h(e.descricao)}</span>` : ""}</li>`).join("")}</ul>
    </div>` : "";
  }).join("");
  return pagina({
    titulo: "Quem é quem",
    profundidade: 0,
    visualizacao: "quem-e-quem",
    corpo: `
<h1>Quem é quem <small>${entidades.length} pessoas e organizações, por divisão</small></h1>
<p class="prosa intro-curta">Cada entidade traz só o que ela é. Nenhuma acusação vive aqui: o que se afirma sobre cada uma está nas afirmações, com fonte e resposta.</p>
<section class="quem-e-quem"><div class="grupos">${grupos}</div></section>`,
  });
};

const paginaSobre = () => pagina({
  titulo: "Sobre",
  profundidade: 0,
  visualizacao: "sobre",
  corpo: `<section class="sobre prosa">${sobreHtml}</section>`,
});

// ---------- fontes: todas, por nível, com uso ----------
const paginaFontes = () => {
  const grupos = [1, 2, 3, 4].map((n) => {
    const lista = fontes.filter((f) => f.nivel === n).sort((a, b) => (a.veiculo || "").localeCompare(b.veiculo || "") || (b.data || "").localeCompare(a.data || ""));
    if (!lista.length) return "";
    return `
<h2>Nível ${n} <small>${NIVEIS[n]} · ${plural(lista.length, "fonte", "fontes")}</small></h2>
<ul class="lista-fontes">
${lista.map((f) => `
  <li>
    <div>
      <a href="${h(f.url)}" target="_blank" rel="noopener">${h(f.titulo || f.url)}</a>
      <small>${h(f.veiculo || "")}${f.data ? " · " + dataBR(f.data) : " · sem data"}${f.nota ? " · " + h(f.nota) : ""}</small>
    </div>
    <span class="uso">${plural(usoDaFonte.get(f.id) || 0, "uso", "usos")}</span>
  </li>`).join("")}
</ul>`;
  }).join("");
  const dominios = Object.entries(permitidas.dominios || {}).sort((a, b) => a[1].nivel - b[1].nivel || a[0].localeCompare(b[0]));
  return pagina({
    titulo: "Fontes",
    profundidade: 0,
    visualizacao: "fontes",
    corpo: `
<h1>Fontes <small>${fontes.length} registradas · ${afirmacoes.length} afirmações</small></h1>
<p class="prosa">Toda afirmação do site aponta para ao menos uma fonte com link. O nível diz de onde a informação vem: quanto menor, mais perto do documento original. Fontes de nível 4 nunca sustentam nada sozinhas.</p>
${grupos}
<h2>Domínios aceitos <small>${dominios.length}</small></h2>
<p class="prosa"><small>${h(permitidas.criterio || "")}</small></p>
<ul class="lista-fontes">
${dominios.map(([dom, d]) => `<li><div>${h(dom)} <small>${h(d.nota || "")}</small></div><span class="uso">nível ${d.nivel}</span></li>`).join("")}
</ul>`,
  });
};

// ---------- casos (cards) ----------
const paginaCasos = () => {
  const raiz = raizDe(0);
  const cards = [...casos].sort((a, b) => (b.atualizado_em || "").localeCompare(a.atualizado_em || ""));
  return pagina({
    titulo: "Casos",
    profundidade: 0,
    visualizacao: "casos",
    corpo: `
<h1>Casos <small>${casos.length}</small></h1>
<ul class="cards">
${cards.map((c) => `
  <li class="card" data-divisoes="${h(c.divisao_principal)}">
    <a href="${raiz}caso/${h(c.slug)}.html">
      ${imagemOuPlaceholder(c, raiz)}
      <div class="corpo"><h3>${h(c.titulo)}</h3><p>${h((c.resumo.match(/^.*?[.!?](?=\s|$)/) || [c.resumo])[0])}</p></div>
    </a>
  </li>`).join("")}
</ul>`,
  });
};

// ---------- grafo (D3) ----------
const paginaGrafo = () => {
  const raiz = raizDe(0);
  const legenda = Object.entries(DIVISOES).map(([id, d]) => `<button type="button" class="grupo-legenda" data-grupo="${id}" aria-pressed="true"><i style="--cor:var(--${id})"></i>${h(d.nome)}</button>`).join("");
  const faixa = (id, rotulo, min, max, passo, valor) => `<label class="faixa">${rotulo}<input type="range" id="${id}" min="${min}" max="${max}" step="${passo}" value="${valor}"></label>`;
  return pagina({
    titulo: "Grafo",
    profundidade: 0,
    visualizacao: "grafo",
    extraHead: `<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>`,
    corpo: `
<div class="grafo-topo">
  <h1>Grafo <small>${grafo.nodes.length} entidades · ${grafo.links.length} ligações</small></h1>
  <div class="controles-grafo">
    <label>Clique
      <select id="modo-grafo">
        <option value="tudo">abre a página</option>
        <option value="clique">destaca as ligações</option>
      </select>
    </label>
    <button type="button" id="grafo-ajustar">Enquadrar</button>
    <button type="button" id="grafo-config" aria-expanded="false" aria-controls="grafo-ajustes">Ajustes</button>
  </div>
</div>
<div class="legenda legenda-grupos" aria-label="Divisões: clique para esconder ou mostrar">${legenda}</div>
<div class="grafo-area">
  <svg id="grafo" role="img" aria-label="Grafo de entidades"></svg>
  <aside id="grafo-painel" hidden></aside>
  <aside id="grafo-ajustes" class="grafo-ajustes" hidden>
    <h3>Filtros</h3>
    <label class="campo">Buscar nós <input type="search" id="g-busca" placeholder="nome" autocomplete="off"></label>
    <h3>Exibição</h3>
    ${faixa("g-tamanho", "Tamanho dos nós", 0.5, 2, 0.1, 1)}
    ${faixa("g-espessura", "Espessura das ligações", 0.2, 3, 0.1, 1)}
    ${faixa("g-rotulos", "Limiar dos rótulos", 0, 2, 0.1, 0.6)}
    <h3>Forças</h3>
    ${faixa("g-centro", "Força central", 0, 1, 0.05, 0.3)}
    ${faixa("g-repulsao", "Repulsão", 0, 1, 0.05, 0.7)}
    ${faixa("g-ligacao", "Força das ligações", 0, 1, 0.05, 0.4)}
    ${faixa("g-distancia", "Distância das ligações", 0, 1, 0.05, 0.55)}
    <label class="campo"><input type="checkbox" id="agrupar-grafo"> Agrupar por divisão</label>
  </aside>
  <p id="grafo-vazio" class="vazio" hidden>Nenhuma ligação com esses filtros.</p>
</div>
<p><small>Cada nó é uma entidade; cada ligação, uma ou mais afirmações que citam as duas. O tamanho do nó cresce com o número de ligações. Passe o mouse para acender as ligações de um nó; aproxime o zoom para ler os rótulos; arraste para reorganizar.</small></p>`,
    extraScript: `
<script>
(function(){
  var DADOS=${json(grafo)};
  var NOMES=${json(Object.fromEntries(Object.entries(DIVISOES).map(([k, v]) => [k, v.nome])))};
  var ORDEM=${json(Object.keys(DIVISOES))};
  var RAIZ=${json(raiz)};
  var svg=d3.select('#grafo'),painel=document.getElementById('grafo-painel'),modoSel=document.getElementById('modo-grafo'),agrupar=document.getElementById('agrupar-grafo');
  var aj={};['tamanho','espessura','rotulos','centro','repulsao','ligacao','distancia'].forEach(function(k){aj[k]=document.getElementById('g-'+k);});
  var busca=document.getElementById('g-busca');
  var sim=null,zoom=null,g=null,no=null,rotulos=null,link=null,nodes=[],links=[],selecionado=null,pairando=null,ticks=0,geracao=0,ancoras={},k=1,ocultos={},divisaoAtual='';
  function cor(grupo){return getComputedStyle(document.documentElement).getPropertyValue('--'+grupo).trim()||'#999';}
  function raio(n){return (5+Math.sqrt(n.grau)*2.6)*Number(aj.tamanho.value);}
  function larg(l){return (.5+Math.min(l.peso,6)*.35)*Number(aj.espessura.value);}
  function norm(s){return (s||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');}
  function vizinhos(id){var s=new Set([id]);links.forEach(function(l){if(l.source.id===id)s.add(l.target.id);if(l.target.id===id)s.add(l.source.id);});return s;}
  // Rótulos: aparecem conforme o zoom passa do limiar (como o "text fade threshold" do Obsidian);
  // nós acesos sempre mostram o rótulo.
  var FONTE_PX=10.5,LARG_CHAR=.5;
  function fontePx(){return FONTE_PX/Math.pow(k,.35);}
  // Divide o nome em duas linhas no espaço mais próximo do meio.
  function duasLinhas(nome){var i=-1,meio=nome.length/2,melhor=1e9;for(var j=0;j<nome.length;j++)if(nome[j]===' '&&Math.abs(j-meio)<melhor){melhor=Math.abs(j-meio);i=j;}return i<0?[nome,'']:[nome.slice(0,i),nome.slice(i+1)];}
  // O nome vai dentro do nó quando cabe (uma ou duas linhas); senão fica logo abaixo.
  function posicionarRotulos(){
    if(!rotulos)return;
    var fu=fontePx()/k;
    rotulos.each(function(n){
      var t=d3.select(this),r=raio(n),largura1=n.nome.length*LARG_CHAR*fu,dentro=false,l1=n.nome,l2='';
      if(largura1<=1.85*r){dentro=true;}
      else{var p=duasLinhas(n.nome);if(p[1]&&Math.max(p[0].length,p[1].length)*LARG_CHAR*fu<=1.85*r&&2.2*fu<=1.85*r){dentro=true;l1=p[0];l2=p[1];}}
      t.classed('dentro',dentro).classed('fora',!dentro);
      t.attr('x',n.x).attr('y',dentro?(n.y-(l2?fu*.55:0)+fu*.35):(n.y+r+fu*1.05));
      t.select('.l1').text(l1);
      t.select('.l2').attr('x',n.x).text(l2);
    });
  }
  function atualizarRotulos(){
    if(!rotulos)return;
    var limiar=Number(aj.rotulos.value),op=Math.max(0,Math.min(1,(k-limiar)/.4));
    rotulos.style('opacity',function(n){var t=d3.select(this);return t.classed('aceso')?1:(t.classed('apagado')?.1:(t.classed('dentro')?Math.max(op,.85):op));}).style('font-size',fontePx()+'px');
    posicionarRotulos();
  }
  function atualizar(){
    if(!no||!link)return;
    var q=norm(busca.value.trim());
    var foco=selecionado||pairando;
    var viz=foco?vizinhos(foco):null;
    var grupoFoco=foco?(nodes.find(function(n){return n.id===foco;})||{}).grupo:null;
    var aceso=function(n){return viz?viz.has(n.id):(q?norm(n.nome).indexOf(q)>=0:false);};
    var apagado=function(n){return viz?!viz.has(n.id):(q?norm(n.nome).indexOf(q)<0:false);};
    no.classed('aceso',aceso).classed('apagado',apagado);
    rotulos.classed('aceso',aceso).classed('apagado',apagado);
    link.classed('acesa',function(l){return !!foco&&(l.source.id===foco||l.target.id===foco);})
        .classed('apagado',function(l){return foco?(l.source.id!==foco&&l.target.id!==foco):(!!q);})
        .style('stroke',function(l){return foco&&(l.source.id===foco||l.target.id===foco)?cor(grupoFoco):null;});
    atualizarRotulos();
  }
  function mostrarPainel(n){
    var viz=links.filter(function(l){return l.source.id===n.id||l.target.id===n.id;})
      .map(function(l){var o=l.source.id===n.id?l.target:l.source;return [o,l.peso];})
      .sort(function(a,b){return b[1]-a[1];});
    painel.innerHTML='<button type="button" class="fechar" aria-label="Fechar">×</button>'
      +'<h3>'+n.nome+'</h3><span class="divisao" style="--cor:var(--'+n.grupo+')">'+NOMES[n.grupo]+'</span>'
      +'<p><small>'+n.grau+' ligação'+(n.grau===1?'':'ões')+'</small></p>'
      +(viz.length?'<ul>'+viz.map(function(v){return '<li>'+v[0].nome+' <small>('+v[1]+')</small></li>';}).join('')+'</ul>':'')
      +'<p><a href="'+RAIZ+'entidade/'+n.id+'.html">Abrir página →</a></p>';
    painel.hidden=false;
    painel.querySelector('.fechar').addEventListener('click',limpar);
  }
  function limpar(){selecionado=null;painel.hidden=true;atualizar();}
  function enquadrar(animar){
    if(!nodes.length||!zoom)return;
    var xs=nodes.map(function(n){return n.x;}),ys=nodes.map(function(n){return n.y;});
    var x0=Math.min.apply(null,xs)-40,x1=Math.max.apply(null,xs)+40,y0=Math.min.apply(null,ys)-40,y1=Math.max.apply(null,ys)+50;
    var box=svg.node().getBoundingClientRect(),W=box.width,H=box.height;
    var kk=Math.min(2.5,.9/Math.max((x1-x0)/W,(y1-y0)/H));
    var t=d3.zoomIdentity.translate(W/2-kk*(x0+x1)/2,H/2-kk*(y0+y1)/2).scale(kk);
    if(animar===false)svg.call(zoom.transform,t);else svg.transition().duration(500).call(zoom.transform,t);
  }
  function calcularAncoras(W,H,grupos){
    ancoras={};var r=Math.min(W,H)*.28;
    grupos.forEach(function(gp,i){var a=-Math.PI/2+2*Math.PI*i/grupos.length;ancoras[gp]={x:W/2+r*Math.cos(a),y:H/2+r*Math.sin(a)};});
  }
  // As quatro forças do Obsidian, em escala 0–1: central, repulsão, força e distância das ligações.
  function aplicarForcas(W,H){
    if(!sim)return;
    var centro=Number(aj.centro.value),rep=Number(aj.repulsao.value),lig=Number(aj.ligacao.value),dist=Number(aj.distancia.value);
    var agrupado=agrupar.checked&&Object.keys(ancoras).length>1;
    sim.force('x',d3.forceX(function(n){return agrupado?ancoras[n.grupo].x:W/2;}).strength(agrupado?.06+centro*.15:centro*.12))
       .force('y',d3.forceY(function(n){return agrupado?ancoras[n.grupo].y:H/2;}).strength(agrupado?.06+centro*.15:centro*.12))
       .force('charge',d3.forceManyBody().strength(-(30+rep*700)))
       .force('link',d3.forceLink(links).id(function(n){return n.id;}).distance(function(l){return (20+dist*220)*(1-Math.min(l.peso,5)*.06);}).strength(function(l){return .05+lig*.9;}))
       .force('collide',d3.forceCollide(function(n){return raio(n)+10+Math.min(n.nome.length,30)*1.1;}).strength(.9));
  }
  function desenhar(divisao){
    divisaoAtual=divisao||'';
    svg.selectAll('*').remove();
    if(sim)sim.stop();
    limpar();
    nodes=DADOS.nodes.filter(function(n){return (!divisao||n.grupo===divisao)&&!ocultos[n.grupo];}).map(function(n){return Object.assign({},n);});
    var ids=new Set(nodes.map(function(n){return n.id;}));
    links=DADOS.links.filter(function(l){return ids.has(l.source)&&ids.has(l.target);}).map(function(l){return Object.assign({},l);});
    document.getElementById('grafo-vazio').hidden=nodes.length>0;
    var box=svg.node().getBoundingClientRect(),W=box.width||900,H=box.height||500;
    var grupos=ORDEM.filter(function(gp){return nodes.some(function(n){return n.grupo===gp;});});
    calcularAncoras(W,H,grupos);
    g=svg.append('g');
    zoom=d3.zoom().scaleExtent([.15,8]).on('zoom',function(ev){k=ev.transform.k;g.attr('transform',ev.transform);atualizarRotulos();});
    svg.call(zoom).on('dblclick.zoom',null).on('click',function(ev){if(ev.target===svg.node())limpar();});
    link=g.append('g').selectAll('line').data(links).join('line').attr('class','aresta').attr('stroke-width',larg);
    no=g.append('g').selectAll('g').data(nodes).join('g').attr('class','no')
      .on('mouseenter',function(ev,n){pairando=n.id;atualizar();})
      .on('mouseleave',function(){pairando=null;atualizar();})
      .on('click',function(ev,n){
        ev.stopPropagation();
        if(modoSel.value==='tudo'){location.href=RAIZ+'entidade/'+n.id+'.html';return;}
        selecionado=(selecionado===n.id)?null:n.id;
        if(selecionado)mostrarPainel(n);else painel.hidden=true;
        atualizar();
      })
      .on('dblclick',function(ev,n){location.href=RAIZ+'entidade/'+n.id+'.html';})
      .call(d3.drag()
        .on('start',function(ev,n){if(!ev.active)sim.alphaTarget(.3).restart();n.fx=n.x;n.fy=n.y;})
        .on('drag',function(ev,n){n.fx=ev.x;n.fy=ev.y;})
        .on('end',function(ev,n){if(!ev.active)sim.alphaTarget(0);n.fx=null;n.fy=null;}));
    no.append('circle').attr('r',raio).attr('fill',function(n){return cor(n.grupo);});
    no.append('title').text(function(n){return n.nome+' — '+n.grau+' ligação(ões)';});
    // Rótulos numa camada própria, acima de todos os nós, para nenhum círculo cobrir um nome.
    rotulos=g.append('g').attr('class','rotulos').selectAll('text').data(nodes).join('text').attr('text-anchor','middle');
    rotulos.append('tspan').attr('class','l1');
    rotulos.append('tspan').attr('class','l2').attr('x',0).attr('dy','1.05em');
    sim=d3.forceSimulation(nodes).alphaDecay(.02).velocityDecay(.35)
      .on('tick',function(){
        ticks++;
        link.attr('x1',function(l){return l.source.x;}).attr('y1',function(l){return l.source.y;})
            .attr('x2',function(l){return l.target.x;}).attr('y2',function(l){return l.target.y;});
        no.attr('transform',function(n){return 'translate('+n.x+','+n.y+')';});
        posicionarRotulos();
      })
      .on('end',function(){enquadrar(true);});
    aplicarForcas(W,H);
    atualizarRotulos();
    ticks=0;
    var minha=++geracao;
    (function cedo(){if(minha!==geracao)return;if(ticks<40){setTimeout(cedo,250);return;}enquadrar(false);})();
  }
  function reaquecer(){if(!sim)return;var box=svg.node().getBoundingClientRect();aplicarForcas(box.width||900,box.height||500);sim.alpha(.6).restart();}
  ['centro','repulsao','ligacao','distancia'].forEach(function(kk){aj[kk].addEventListener('input',reaquecer);});
  aj.tamanho.addEventListener('input',function(){if(!no)return;no.select('circle').attr('r',raio);posicionarRotulos();reaquecer();});
  aj.espessura.addEventListener('input',function(){if(link)link.attr('stroke-width',larg);});
  aj.rotulos.addEventListener('input',atualizarRotulos);
  agrupar.addEventListener('change',reaquecer);
  busca.addEventListener('input',atualizar);
  document.getElementById('grafo-config').addEventListener('click',function(){var p=document.getElementById('grafo-ajustes');p.hidden=!p.hidden;this.setAttribute('aria-expanded',String(!p.hidden));});
  document.querySelectorAll('.grupo-legenda').forEach(function(b){b.addEventListener('click',function(){var gp=b.dataset.grupo;ocultos[gp]=!ocultos[gp];b.setAttribute('aria-pressed',String(!ocultos[gp]));desenhar(divisaoAtual);});});
  document.getElementById('grafo-ajustar').addEventListener('click',function(){enquadrar(true);});
  modoSel.addEventListener('change',limpar);
  document.addEventListener('keydown',function(ev){if(ev.key==='Escape')limpar();});
  document.addEventListener('filtro-divisao',function(ev){desenhar(ev.detail);});
  function recolorir(){if(no)no.select('circle').attr('fill',function(n){return cor(n.grupo);});}
  document.addEventListener('tema-mudou',recolorir);
  if(window.matchMedia)window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',recolorir);
  window.addEventListener('resize',function(){clearTimeout(window.__rg);window.__rg=setTimeout(function(){enquadrar(true);},200);});
  desenhar(document.getElementById('filtro-divisao').value);
})();
</script>`,
  });
};

// ---------- árvore ----------
// Árvore do caso: tempo de cima para baixo, uma coluna por caso, como o gráfico de ramos de um
// repositório git. Cada ramo nasce de um caso relacionado que começou antes (ou do tronco, o
// primeiro caso). Os pontos são afirmações; um mesmo registro pode aparecer em mais de um ramo.
const renderArvoreTempo = (raiz) => {
  const ordem = casosCronologicos.map((c) => ({ c, datas: c.afirmacoes.map((id) => afrPorId.get(id)?.data).filter(Boolean).sort() })).filter((x) => x.datas.length);
  ordem.forEach((x, i) => { x.col = i; x.inicio = x.datas[0]; x.fim = x.datas[x.datas.length - 1]; });
  const porIdCaso = new Map(ordem.map((x) => [x.c.id, x]));
  for (const x of ordem) {
    const pais = (x.c.casos_relacionados || []).map((id) => porIdCaso.get(id))
      .filter((p) => p && (p.inicio < x.inicio || (p.inicio === x.inicio && p.col < x.col)))
      .sort((a, b) => b.inicio.localeCompare(a.inicio));
    x.pai = pais[0] || (x !== ordem[0] ? ordem[0] : null);
  }
  const eventos = ordem.map((x) => ({ tipo: "ramo", data: x.inicio, x }));
  const vistos = new Set();
  for (const x of ordem) for (const id of x.c.afirmacoes) {
    const a = afrPorId.get(id);
    if (!a?.data || vistos.has(id)) continue;
    vistos.add(id);
    eventos.push({ tipo: "afr", data: a.data, a, casos: ordem.filter((o) => o.c.afirmacoes.includes(id)) });
  }
  eventos.sort((e1, e2) => e1.data.localeCompare(e2.data) || (e1.tipo === "ramo" ? 0 : 1) - (e2.tipo === "ramo" ? 0 : 1));
  const ROW = 30, TOPO = 22, GUT = 66, COLW = 22, X0 = GUT + 18, XT = X0 + ordem.length * COLW + 22, W = XT + 820, H = TOPO + eventos.length * ROW + 16;
  const xCol = (i) => X0 + i * COLW;
  eventos.forEach((e, i) => { e.y = TOPO + i * ROW + ROW / 2; });
  const ySDoCaso = (x) => eventos.filter((e) => (e.tipo === "ramo" && e.x === x) || (e.tipo === "afr" && e.casos.includes(x))).map((e) => e.y);
  let meses = "", mesAnt = null;
  for (const e of eventos) {
    const mes = mesDe(e.data);
    if (mes !== mesAnt) { meses += `<line class="mes-linha" x1="0" y1="${e.y - ROW / 2}" x2="${W}" y2="${e.y - ROW / 2}"/><text class="mes" x="${GUT - 8}" y="${e.y + 4}" text-anchor="end">${h(mes)}</text>`; mesAnt = mes; }
  }
  let trilhas = "";
  for (const x of ordem) {
    const ys = ySDoCaso(x), y0 = Math.min(...ys), y1 = Math.max(...ys), cx = xCol(x.col);
    x.y0 = y0; x.y1 = y1;
    trilhas += `<line class="trilha" style="--cor:var(--${h(x.c.divisao_principal)})" x1="${cx}" y1="${y0}" x2="${cx}" y2="${y1}"/>`;
  }
  for (const x of ordem) {
    if (!x.pai) continue;
    const xp = xCol(x.pai.col), xn = xCol(x.col), yr = x.y0;
    const fraca = x.pai.y1 < yr - ROW;
    if (fraca) trilhas += `<line class="trilha fraca" style="--cor:var(--${h(x.pai.c.divisao_principal)})" x1="${xp}" y1="${x.pai.y1}" x2="${xp}" y2="${yr - ROW}"/>`;
    trilhas += `<path class="bifurcacao${fraca ? " fraca" : ""}" style="--cor:var(--${h(x.c.divisao_principal)})" d="M${xp},${yr - ROW} C${xp},${yr - ROW / 2} ${xn},${yr - ROW / 2} ${xn},${yr}"><title>${h(x.c.titulo)} nasce de: ${h(x.pai.c.titulo)}</title></path>`;
  }
  let itens = "";
  for (const e of eventos) {
    if (e.tipo === "ramo") {
      const x = e.x;
      itens += `
      <g class="linha-ramo" data-divisoes="${h(x.c.divisao_principal)}" style="--cor:var(--${h(x.c.divisao_principal)})">
        <rect class="fundo-linha" x="0" y="${e.y - ROW / 2}" width="${W}" height="${ROW}"/>
        <circle class="no-ramo" cx="${xCol(x.col)}" cy="${e.y}" r="6"/>
        <a href="${raiz}caso/${h(x.c.slug)}.html"><text class="titulo-ramo" x="${XT}" y="${e.y + 4}">${h(x.c.titulo)} <tspan class="meta">· ${plural(x.c.afirmacoes.length, "registro", "registros")}, ${h(dataBR(x.inicio))} a ${h(dataBR(x.fim))}</tspan></text></a>
      </g>`;
    } else {
      const a = e.a, principal = e.casos[0];
      const pontos = e.casos.map((x, i) => `<circle class="ponto${i ? " secundario" : ""} natureza-${h(a.natureza)}" style="--cor:var(--${h(x.c.divisao_principal)})" cx="${xCol(x.col)}" cy="${e.y}" r="${i ? 3.5 : 5}"><title>${h(x.c.titulo)}</title></circle>`).join("");
      itens += `
      <g class="linha-afr" data-natureza="${h(a.natureza)}" data-divisoes="${h(divisoesDaAfirmacao(a).join(" "))}">
        <rect class="fundo-linha" x="0" y="${e.y - ROW / 2}" width="${W}" height="${ROW}"/>
        ${pontos}
        <a href="${raiz}caso/${h(principal.c.slug)}.html#${h(a.id)}"><text class="texto" x="${XT}" y="${e.y + 4}"><tspan class="data">${h(dataBR(a.data))}</tspan> <tspan class="nat natureza-${h(a.natureza)}">${h(NATUREZAS[a.natureza] || a.natureza)}</tspan> ${h(resumoCurto(a.texto, 118))}</text></a>
      </g>`;
    }
  }
  const legenda = ordem.map((x) => `<li style="--cor:var(--${h(x.c.divisao_principal)})"><span class="coluna">${x.col + 1}</span> <a href="${raiz}caso/${h(x.c.slug)}.html">${h(x.c.titulo)}</a></li>`).join("");
  return `
<section class="arvore-tempo">
  <p class="prosa intro-curta">O tempo corre de cima para baixo. Cada coluna é um caso; a linha vertical dura do primeiro ao último registro, e a curva mostra de qual caso o novo ramo nasce. Os pontos são afirmações, coloridos pela natureza; um ponto vazado marca o mesmo registro em outro ramo. Clique numa linha para ler.</p>
  <div class="arvore-tempo-rolagem">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet" style="min-width:${Math.round(W * 0.85)}px" role="img" aria-label="Árvore do caso no tempo">
      <g class="meses">${meses}</g>
      <g class="trilhas">${trilhas}</g>
      ${itens}
    </svg>
  </div>
  <ol class="ramos-legenda">${legenda}</ol>
</section>`;
};

const paginaArvore = () => {
  const raiz = raizDe(0);
  const ramos = Object.entries(DIVISOES).map(([divId, d]) => {
    const ents = entidades.filter((e) => e.grupo === divId).sort((a, b) => a.nome.localeCompare(b.nome));
    const corpoEnts = ents.length ? ents.map((e) => {
      const seusCasos = casosDaEntidade(e.id);
      const corpoCasos = seusCasos.length ? seusCasos.map((c) => {
        const afrs = c.afirmacoes.map((id) => afrPorId.get(id)).filter((a) => a && entidadesDaAfirmacao(a).includes(e.id)).sort(porData);
        return `
        <details>
          <summary>${linkCaso(c, raiz)} <small>${afrs.length}</small></summary>
          <ul>${afrs.map((a) => renderAfirmacaoCurta(a, c, raiz)).join("")}</ul>
        </details>`;
      }).join("") : `<p class="vazio">Sem casos.</p>`;
      return `
      <details>
        <summary>${linkEntidade(e.id, raiz)} <small>${plural(seusCasos.length, "caso", "casos")}</small></summary>
        ${corpoCasos}
      </details>`;
    }).join("") : `<p class="vazio">Nenhuma entidade nesta divisão ainda.</p>`;
    return `
    <details open data-divisoes="${divId}">
      <summary class="divisao-titulo" style="--cor:var(--${divId})">${h(d.nome)} <small>${ents.length}</small></summary>
      ${corpoEnts}
    </details>`;
  }).join("");
  return pagina({
    titulo: "Árvore",
    profundidade: 0,
    visualizacao: "arvore",
    corpo: `
<div class="grafo-topo">
  <h1>Árvore <small>de onde o caso começou e para onde foi</small></h1>
  <div class="controles-grafo">
    <button type="button" onclick="document.querySelectorAll('.arvore details').forEach(function(d){d.open=true})">Expandir tudo</button>
    <button type="button" onclick="document.querySelectorAll('.arvore details details').forEach(function(d){d.open=false})">Recolher tudo</button>
  </div>
</div>
${renderArvoreTempo(raiz)}
<h2>Estrutura <small>divisão → entidade → casos → afirmações</small></h2>
<div class="arvore">${ramos}</div>`,
  });
};

// ---------- páginas de aprofundamento ----------
const paginaCaso = (c) => {
  const raiz = raizDe(1);
  const afrs = c.afirmacoes.map((id) => afrPorId.get(id)).filter(Boolean).sort(porData);
  const relacionados = (c.casos_relacionados || []).map((id) => casoPorId.get(id)).filter(Boolean);
  const pos = casosCronologicos.findIndex((x) => x.id === c.id);
  const anterior = casosCronologicos[pos - 1], proximo = casosCronologicos[pos + 1];

  const contagem = new Map();
  for (const a of afrs) for (const id of entidadesDaAfirmacao(a)) contagem.set(id, (contagem.get(id) || 0) + 1);
  const ligacoes = Object.entries(DIVISOES).map(([divId]) => {
    const ents = [...contagem].map(([id, n]) => [entPorId.get(id), n]).filter(([e]) => e?.grupo === divId)
      .sort((x, y) => y[1] - x[1] || x[0].nome.localeCompare(y[0].nome));
    return ents.length ? `
    <div class="grupo">
      ${rotuloDivisao(divId)}
      <ul>${ents.map(([e, n]) => `<li>${linkEntidade(e.id, raiz)} <small>${n}</small></li>`).join("")}</ul>
    </div>` : "";
  }).join("");

  return pagina({
    titulo: c.titulo,
    profundidade: 1,
    corpo: `
<article class="caso duas-colunas">
  <div class="prosa">
    <p>${rotuloDivisao(c.divisao_principal)}</p>
    <h1>${h(c.titulo)}</h1>
    ${c.imagem?.arquivo ? imagemOuPlaceholder(c, raiz) : ""}
    <p class="resumo">${h(c.resumo)}</p>
    <h2>Afirmações <small>${afrs.length}</small></h2>
    ${afrs.map((a) => renderAfirmacao(a, raiz, { mostrarCasos: false })).join("\n")}
    <p><small>Registrado em ${h(dataBR(c.registrado_em))} · atualizado em ${h(dataBR(c.atualizado_em))}</small></p>
    <nav class="anterior-proximo" aria-label="Casos em ordem cronológica">
      ${anterior ? `<a class="anterior" href="${raiz}caso/${h(anterior.slug)}.html"><small>← caso anterior</small>${h(anterior.titulo)}</a>` : ""}
      ${proximo ? `<a class="proximo" href="${raiz}caso/${h(proximo.slug)}.html"><small>próximo caso →</small>${h(proximo.titulo)}</a>` : ""}
    </nav>
  </div>
  <aside class="lateral">
    <section class="ligacoes">
      <h2>Ligações por divisão</h2>
      ${ligacoes}
    </section>
    ${relacionados.length ? `
    <section>
      <h2>Casos relacionados</h2>
      <ul>${relacionados.map((r) => `<li>${linkCaso(r, raiz)}</li>`).join("")}</ul>
    </section>` : ""}
  </aside>
</article>`,
  });
};

const paginaEntidade = (e) => {
  const raiz = raizDe(1);
  const afrs = afirmacoesDaEntidade(e.id).sort(porData);
  const seusCasos = casosDaEntidade(e.id);
  const vizinhos = vizinhosDe(e.id);
  return pagina({
    titulo: e.nome,
    profundidade: 1,
    corpo: `
<article class="entidade-pagina duas-colunas">
  <div class="prosa">
    <p>${rotuloDivisao(e.grupo)} <small>· ${h(e.tipo)} ·</small> ${selo(e)}</p>
    <h1>${h(e.nome)}</h1>
    ${e.descricao ? `<p class="descricao">${h(e.descricao)}</p>` : ""}
    <h2>Afirmações <small>${afrs.length}</small></h2>
    ${afrs.length ? afrs.map((a) => renderAfirmacao(a, raiz)).join("\n") : `<p class="vazio">Nenhuma afirmação registrada.</p>`}
  </div>
  <aside class="lateral">
    <section>
      <h2>Ligações <small>${vizinhos.length}</small></h2>
      ${renderGrafoLocal(e, raiz)}
      ${vizinhos.length ? `<ul>${vizinhos.map(([v, n]) => `<li>${linkEntidade(v.id, raiz)} <small>${n}</small></li>`).join("")}</ul>` : `<p class="vazio">Nenhuma ligação.</p>`}
    </section>
    <section>
      <h2>Casos <small>${seusCasos.length}</small></h2>
      ${seusCasos.length ? `<ul>${seusCasos.map((c) => `<li>${linkCaso(c, raiz)}</li>`).join("")}</ul>` : `<p class="vazio">Nenhum caso.</p>`}
    </section>
  </aside>
</article>`,
  });
};

// ---------- escrita ----------
rmSync(SITE, { recursive: true, force: true });
mkdirSync(join(SITE, "caso"), { recursive: true });
mkdirSync(join(SITE, "entidade"), { recursive: true });
if (existsSync(IMAGENS)) cpSync(IMAGENS, join(SITE, "imagens"), { recursive: true });

const escreve = (rel, html) => { writeFileSync(join(SITE, rel), html); return rel; };
writeFileSync(join(SITE, "indice-busca.js"), `window.INDICE_BUSCA=${json(indiceBusca)};`);
const geradas = [
  escreve("index.html", paginaInicial()),
  escreve("linha-do-tempo.html", paginaLinhaDoTempo()),
  escreve("quem-e-quem.html", paginaQuemEQuem()),
  escreve("sobre.html", paginaSobre()),
  escreve("fontes.html", paginaFontes()),
  escreve("casos.html", paginaCasos()),
  escreve("grafo.html", paginaGrafo()),
  escreve("arvore.html", paginaArvore()),
  ...casos.map((c) => escreve(join("caso", `${c.slug}.html`), paginaCaso(c))),
  ...entidades.map((e) => escreve(join("entidade", `${e.id}.html`), paginaEntidade(e))),
];

// ---------- verificação de links e imagens internos ----------
const arquivosHtml = (dir) =>
  readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? arquivosHtml(p) : p.endsWith(".html") ? [p] : []; });
const semScripts = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "");
const quebrados = [];
let internos = 0;
for (const arq of arquivosHtml(SITE)) {
  const html = semScripts(readFileSync(arq, "utf8"));
  for (const [, ref] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|#|data:)/.test(ref)) continue;
    internos++;
    const [caminho, ancora] = ref.split("#");
    const alvo = resolve(dirname(arq), caminho.split("?")[0]);
    if (!existsSync(alvo)) { quebrados.push(`${arq.slice(SITE.length + 1)} → ${ref}`); continue; }
    if (ancora && !readFileSync(alvo, "utf8").includes(`id="${ancora}"`)) quebrados.push(`${arq.slice(SITE.length + 1)} → ${ref} (âncora inexistente)`);
  }
}
for (const it of indiceBusca) {
  const [caminho, ancora] = it.url.split("#");
  const alvo = join(SITE, caminho);
  if (!existsSync(alvo)) quebrados.push(`índice de busca → ${it.url}`);
  else if (ancora && !readFileSync(alvo, "utf8").includes(`id="${ancora}"`)) quebrados.push(`índice de busca → ${it.url} (âncora inexistente)`);
}

console.log(`=== CONSTRUÇÃO ===\n${geradas.length} páginas em site/ (4 visualizações · sobre · fontes · ${casos.length} casos · ${entidades.length} entidades)`);
console.log(`${grafo.nodes.length} nós · ${grafo.links.length} arestas derivadas`);
console.log(`${indiceBusca.length} registros no índice de busca`);
console.log(`${internos} links e imagens internos verificados`);
if (quebrados.length) { console.log("LINKS QUEBRADOS:"); quebrados.forEach((q) => console.log("  ✗ " + q)); }
process.exit(quebrados.length ? 1 : 0);
