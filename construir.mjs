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
      url: caso ? `caso/${caso.slug}.html#${a.id}` : `index.html#${a.id}`, divisoes: divisoesDaAfirmacao(a),
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

const renderLinhaDoTempo = (lista, raiz) => `
<section id="linha-do-tempo" class="linha">
  <div class="linha-cabecalho">
    <h2>Linha do tempo <small>${plural(lista.length, "afirmação", "afirmações")}</small></h2>
    <div class="linha-nav">
      <button type="button" data-dir="-1" aria-label="Anterior">←</button>
      <button type="button" data-dir="1" aria-label="Próxima">→</button>
    </div>
  </div>
  <div class="trilho" tabindex="0" aria-label="Linha do tempo, role para o lado">
    ${lista.map((a) => renderAfirmacao(a, raiz)).join("\n")}
  </div>
</section>`;

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
const inline = (s) =>
  h(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

const markdown = (md) => {
  const saida = [];
  let paragrafo = [];
  let lista = null;
  const fechaParagrafo = () => { if (paragrafo.length) { saida.push(`<p>${inline(paragrafo.join(" "))}</p>`); paragrafo = []; } };
  const fechaLista = () => { if (lista) { saida.push(`<ul>${lista.join("")}</ul>`); lista = null; } };
  for (const linha of md.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    const t = linha.trim();
    const titulo = t.match(/^(#{1,3})\s+(.*)/);
    if (titulo) { fechaParagrafo(); fechaLista(); const n = titulo[1].length + 1; saida.push(`<h${n}>${inline(titulo[2])}</h${n}>`); }
    else if (t.startsWith("- ")) { fechaParagrafo(); (lista ||= []).push(`<li>${inline(t.slice(2))}</li>`); }
    else if (t === "") { fechaParagrafo(); fechaLista(); }
    else { fechaLista(); paragrafo.push(t); }
  }
  fechaParagrafo(); fechaLista();
  return saida.join("\n");
};
const sobreMd = existsSync(join(DADOS, "sobre.md")) ? readFileSync(join(DADOS, "sobre.md"), "utf8") : "# Sobre\n\nTODO: criar dados/sobre.md";
const sobreHtml = markdown(sobreMd);
const primeiroParagrafo = (sobreHtml.match(/<p>([\s\S]*?)<\/p>/) || [])[1] || "";

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
.abertura .lede{font-family:var(--serifa);font-size:clamp(1.2rem,2vw,1.55rem);line-height:1.4;max-width:38rem;margin:0}
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
.trilho{position:relative;display:flex;gap:2.5rem;overflow-x:auto;scroll-snap-type:x proximity;scroll-padding-inline-start:var(--margem);padding:2rem 0 1.5rem;margin:0 calc(-1 * var(--margem));padding-inline:var(--margem);scrollbar-width:thin;outline:none;cursor:grab}
.trilho.arrastando,.trilho.rolando{scroll-snap-type:none}
.trilho.arrastando{cursor:grabbing;user-select:none}
.trilho:focus-visible{box-shadow:inset 0 0 0 1px var(--borda-forte)}
.trilho .afirmacao{flex:0 0 clamp(18rem,26vw,25rem);margin:0;position:relative;padding-top:1.3rem;scroll-snap-align:start}
.trilho .afirmacao::before{content:"";position:absolute;top:.33rem;left:0;right:-2.5rem;height:1px;background:var(--borda)}
.trilho .afirmacao:last-child::before{right:0}
.trilho .afirmacao::after{content:"";position:absolute;top:0;left:0;width:.7rem;height:.7rem;border-radius:50%;background:var(--cor,var(--borda-forte))}
.trilho .afirmacao[data-natureza=fato]{--cor:var(--fato)}.trilho .afirmacao[data-natureza=decisao]{--cor:var(--decisao)}
.trilho .afirmacao[data-natureza=alegacao]{--cor:var(--alegacao)}.trilho .afirmacao[data-natureza=desmentido]{--cor:var(--desmentido)}
.trilho .afirmacao .texto{font-size:1rem}
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
.grafo-area{position:relative;margin:1rem calc(-1 * var(--margem)) 0}
#grafo{display:block;width:100%;height:calc(100vh - 15rem);min-height:26rem;background:var(--fundo)}
#grafo .no{cursor:pointer}
#grafo .no circle{transition:opacity .25s}
#grafo .no text{font-size:.74rem;fill:var(--texto-suave);pointer-events:none;paint-order:stroke;stroke:var(--fundo);stroke-width:3px;transition:opacity .25s}
#grafo .aresta{stroke:var(--borda-forte);stroke-opacity:.55;transition:opacity .25s,stroke-opacity .25s}
#grafo .apagado{opacity:.12}
#grafo .no.aceso text{fill:var(--texto)}
#grafo .aresta.acesa{stroke:var(--texto);stroke-opacity:.8}
#grafo .rotulo-divisao{font-family:var(--serifa);font-size:.95rem;fill:var(--cor);opacity:.55;pointer-events:none}
#grafo-painel{position:absolute;top:1rem;right:var(--margem);width:17rem;max-width:calc(100% - 2*var(--margem));background:var(--superficie);border:1px solid var(--borda);border-radius:6px;padding:.9rem 1.1rem;font-size:.9rem;box-shadow:0 6px 24px rgba(0,0,0,.06)}
#grafo-painel h3{margin:0 0 .2rem}
#grafo-painel ul{margin:.5rem 0 0;padding-left:1.1rem}
#grafo-painel .fechar{position:absolute;top:.4rem;right:.5rem;border:none;padding:.1rem .4rem;font-size:1rem}
.legenda{display:flex;gap:1.25rem;flex-wrap:wrap;font-size:.82rem;margin:.75rem 0;color:var(--texto-suave)}
.legenda i{display:inline-block;width:.6rem;height:.6rem;border-radius:50%;background:var(--cor);vertical-align:middle;margin-right:.4rem}
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
@media (min-width:64rem){.duas-colunas{grid-template-columns:minmax(0,46rem) minmax(16rem,22rem)}.lateral{position:sticky;top:5rem;align-self:start}}
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
    var s=estado();if(!s)return;
    var partes=href.split('#');
    a.setAttribute('href',partes[0].split('?')[0]+s+(partes[1]?'#'+partes[1]:''));
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
  var cartoes=function(){return Array.prototype.slice.call(trilho.querySelectorAll('.afirmacao:not([hidden])'));};
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
})();`;

const VISUALIZACOES = [
  ["linha-do-tempo", "Linha do tempo", "index.html"],
  ["casos", "Casos", "casos.html"],
  ["grafo", "Grafo", "grafo.html"],
  ["arvore", "Árvore", "arvore.html"],
];
const SECUNDARIAS = [
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
<footer><p>${h(AVISO)} · <a href="${raiz}index.html">Início</a> · <a href="${raiz}sobre.html">Sobre</a> · <a href="${raiz}fontes.html">Fontes</a></p></footer>
<script>${SCRIPT_ESTADO}</script>
<script>${SCRIPT_BUSCA}</script>
<script>${SCRIPT_LINHA}</script>
${extraScript}
</body>
</html>
`;
};

// ---------- página inicial: abertura curta, números e linha do tempo ----------
const paginaInicial = () => {
  const raiz = raizDe(0);
  const cronologia = [...afirmacoes].sort(porData);
  const afrConferidas = afirmacoes.filter(conferida).length;
  return pagina({
    titulo: "Início",
    profundidade: 0,
    visualizacao: "linha-do-tempo",
    corpo: `
<section class="abertura">
  <p class="lede">${primeiroParagrafo} <a href="${raiz}sobre.html">Sobre o projeto e o caso →</a></p>
  <dl class="numeros">
    <div><dt>afirmações</dt><dd>${afirmacoes.length}<small>${afrConferidas} conferidas</small></dd></div>
    <div><dt>casos</dt><dd>${casos.length}</dd></div>
    <div><dt>entidades</dt><dd>${entidades.length}</dd></div>
    <div><dt>fontes</dt><dd>${fontes.length}</dd></div>
  </dl>
</section>
${renderLinhaDoTempo(cronologia, raiz)}`,
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
  const legenda = Object.entries(DIVISOES).map(([id, d]) => `<span><i style="--cor:var(--${id})"></i>${h(d.nome)}</span>`).join("");
  return pagina({
    titulo: "Grafo",
    profundidade: 0,
    visualizacao: "grafo",
    extraHead: `<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>`,
    corpo: `
<div class="grafo-topo">
  <h1>Grafo <small>${grafo.nodes.length} entidades · ${grafo.links.length} ligações</small></h1>
  <div class="controles-grafo">
    <label>Modo
      <select id="modo-grafo">
        <option value="tudo">Tudo aceso</option>
        <option value="clique">Destacar ao clicar</option>
      </select>
    </label>
    <label><input type="checkbox" id="agrupar-grafo" checked> Agrupar por divisão</label>
    <button type="button" id="grafo-ajustar">Enquadrar</button>
  </div>
</div>
<div class="legenda">${legenda}</div>
<div class="grafo-area">
  <svg id="grafo" role="img" aria-label="Grafo de entidades"></svg>
  <aside id="grafo-painel" hidden></aside>
  <p id="grafo-vazio" class="vazio" hidden>Nenhuma ligação dentro desta divisão.</p>
</div>
<p><small>Cada nó é uma entidade; cada ligação, uma ou mais afirmações que citam as duas. Em "Tudo aceso", clique abre a página da entidade. Em "Destacar ao clicar", clique acende as ligações do nó e o clique duplo abre a página.</small></p>`,
    extraScript: `
<script>
(function(){
  var DADOS=${json(grafo)};
  var NOMES=${json(Object.fromEntries(Object.entries(DIVISOES).map(([k, v]) => [k, v.nome])))};
  var ORDEM=${json(Object.keys(DIVISOES))};
  var RAIZ=${json(raiz)};
  var svg=d3.select('#grafo'), painel=document.getElementById('grafo-painel'), modoSel=document.getElementById('modo-grafo'), agrupar=document.getElementById('agrupar-grafo');
  var sim=null, zoom=null, g=null, no=null, link=null, nodes=[], links=[], selecionado=null, pairando=null, ticks=0, geracao=0, ancoras={};
  function cor(grupo){return getComputedStyle(document.documentElement).getPropertyValue('--'+grupo).trim()||'#999';}
  function raio(n){return 4+Math.sqrt(n.grau)*2.4;}
  function vizinhos(id){var s=new Set([id]);links.forEach(function(l){if(l.source.id===id)s.add(l.target.id);if(l.target.id===id)s.add(l.source.id);});return s;}
  function atualizar(){
    if(!no||!link)return;
    var foco=selecionado||pairando;
    if(!foco){no.classed('apagado',false).classed('aceso',false);link.classed('apagado',false).classed('acesa',false);return;}
    var viz=vizinhos(foco);
    no.classed('aceso',function(n){return viz.has(n.id);}).classed('apagado',function(n){return !viz.has(n.id);});
    link.classed('acesa',function(l){return l.source.id===foco||l.target.id===foco;})
        .classed('apagado',function(l){return l.source.id!==foco&&l.target.id!==foco;});
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
    var x0=Math.min.apply(null,xs)-60,x1=Math.max.apply(null,xs)+140,y0=Math.min.apply(null,ys)-50,y1=Math.max.apply(null,ys)+50;
    var box=svg.node().getBoundingClientRect(),W=box.width,H=box.height;
    var k=Math.min(2,.92/Math.max((x1-x0)/W,(y1-y0)/H));
    var t=d3.zoomIdentity.translate(W/2-k*(x0+x1)/2,H/2-k*(y0+y1)/2).scale(k);
    if(animar===false)svg.call(zoom.transform,t);else svg.transition().duration(500).call(zoom.transform,t);
  }
  // Uma âncora por divisão, num círculo: com "agrupar" ligado, cada nó é puxado de leve para a sua.
  function calcularAncoras(W,H,grupos){
    ancoras={};var r=Math.min(W,H)*.3;
    grupos.forEach(function(gp,i){var a=-Math.PI/2+2*Math.PI*i/grupos.length;ancoras[gp]={x:W/2+r*Math.cos(a),y:H/2+r*Math.sin(a)};});
  }
  function forcasDeGrupo(){
    var ligado=agrupar.checked&&Object.keys(ancoras).length>1;
    sim.force('x',ligado?d3.forceX(function(n){return ancoras[n.grupo].x;}).strength(.14):null)
       .force('y',ligado?d3.forceY(function(n){return ancoras[n.grupo].y;}).strength(.14):null);
    g.selectAll('.rotulo-divisao').attr('opacity',ligado?null:0);
  }
  function desenhar(divisao){
    svg.selectAll('*').remove();
    if(sim)sim.stop();
    limpar();
    nodes=DADOS.nodes.filter(function(n){return !divisao||n.grupo===divisao;}).map(function(n){return Object.assign({},n);});
    var ids=new Set(nodes.map(function(n){return n.id;}));
    links=DADOS.links.filter(function(l){return ids.has(l.source)&&ids.has(l.target);}).map(function(l){return Object.assign({},l);});
    document.getElementById('grafo-vazio').hidden=nodes.length>0;
    var box=svg.node().getBoundingClientRect(),W=box.width||900,H=box.height||500;
    var grupos=ORDEM.filter(function(gp){return nodes.some(function(n){return n.grupo===gp;});});
    calcularAncoras(W,H,grupos);
    g=svg.append('g');
    zoom=d3.zoom().scaleExtent([.3,4]).on('zoom',function(ev){g.attr('transform',ev.transform);});
    svg.call(zoom).on('dblclick.zoom',null).on('click',function(ev){if(ev.target===svg.node())limpar();});
    if(grupos.length>1)g.append('g').selectAll('text').data(grupos).join('text').attr('class','rotulo-divisao')
      .attr('x',function(gp){return ancoras[gp].x;}).attr('y',function(gp){return ancoras[gp].y-70;}).attr('text-anchor','middle')
      .each(function(gp){this.style.setProperty('--cor','var(--'+gp+')');}).text(function(gp){return NOMES[gp];});
    link=g.append('g').selectAll('line').data(links).join('line').attr('class','aresta').attr('stroke-width',function(l){return .8+l.peso*.7;});
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
    no.append('text').attr('dx',function(n){return raio(n)+5;}).attr('dy','.35em').text(function(n){return n.nome;});
    no.append('title').text(function(n){return n.nome+' — '+n.grau+' ligação(ões)';});
    sim=d3.forceSimulation(nodes)
      .force('link',d3.forceLink(links).id(function(n){return n.id;}).distance(function(l){return 150-Math.min(l.peso,5)*12;}))
      .force('charge',d3.forceManyBody().strength(-520))
      .force('center',d3.forceCenter(W/2,H/2))
      .force('collide',d3.forceCollide(function(n){return raio(n)+22;}))
      .on('tick',function(){
        ticks++;
        link.attr('x1',function(l){return l.source.x;}).attr('y1',function(l){return l.source.y;})
            .attr('x2',function(l){return l.target.x;}).attr('y2',function(l){return l.target.y;});
        no.attr('transform',function(n){return 'translate('+n.x+','+n.y+')';});
      })
      .on('end',function(){enquadrar(true);});
    forcasDeGrupo();
    ticks=0;
    var minha=++geracao;
    (function cedo(){if(minha!==geracao)return;if(ticks<40){setTimeout(cedo,250);return;}enquadrar(false);})();
  }
  document.getElementById('grafo-ajustar').addEventListener('click',function(){enquadrar(true);});
  modoSel.addEventListener('change',limpar);
  agrupar.addEventListener('change',function(){if(!sim)return;forcasDeGrupo();sim.alpha(.6).restart();});
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
  <h1>Árvore <small>divisão → entidade → casos → afirmações</small></h1>
  <div class="controles-grafo">
    <button type="button" onclick="document.querySelectorAll('.arvore details').forEach(function(d){d.open=true})">Expandir tudo</button>
    <button type="button" onclick="document.querySelectorAll('.arvore details details').forEach(function(d){d.open=false})">Recolher tudo</button>
  </div>
</div>
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
    const alvo = resolve(dirname(arq), caminho);
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
