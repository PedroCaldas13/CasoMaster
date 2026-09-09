// Gera o site estático em site/ a partir de dados/. Sem dependências além do D3 (CDN) no grafo.
// Uso: node construir.mjs  (sai com código 1 se algum link interno estiver quebrado)
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = dirname(fileURLToPath(import.meta.url));
const DADOS = join(RAIZ, "dados");
const SITE = join(RAIZ, "site");

const load = (nome) => JSON.parse(readFileSync(join(DADOS, nome), "utf8"));
const { fontes } = load("fontes.json");
const { entidades } = load("entidades.json");
const { afirmacoes } = load("afirmacoes.json");
const { casos } = load("casos.json");

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
// Divisões tocadas por uma afirmação: base do filtro na linha do tempo.
const divisoesDaAfirmacao = (a) =>
  [...new Set(entidadesDaAfirmacao(a).map((id) => entPorId.get(id)?.grupo).filter(Boolean))];

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

const dataBR = (iso) => {
  if (!iso) return "sem data";
  const [a, m, d] = iso.split("-");
  return d ? `${d}/${m}/${a}` : m ? `${m}/${a}` : a;
};

// ---------- índice de busca ----------
// Um registro por entidade, caso e afirmação. "extra" carrega nomes de entidades ligadas, para que
// buscar uma pessoa encontre também os casos e afirmações que a envolvem.
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

const primeiraFrase = (s) => (s.match(/^.*?[.!?](?=\s|$)/) || [s])[0];

const raizDe = (profundidade) => (profundidade === 0 ? "./" : "../".repeat(profundidade));

const linkEntidade = (id, raiz) => {
  const e = entPorId.get(id);
  return e
    ? `<a class="entidade" href="${raiz}entidade/${h(e.id)}.html" data-divisao="${h(e.grupo)}">${h(e.nome)}</a>`
    : `<span class="entidade desconhecida">${h(id)}</span>`;
};
const linkCaso = (c, raiz) => `<a href="${raiz}caso/${h(c.slug)}.html">${h(c.titulo)}</a>`;
const badgeDivisao = (id) => {
  const d = DIVISOES[id];
  return d ? `<span class="divisao" style="--cor:${d.cor}">${h(d.nome)}</span>` : "";
};
const badgeNatureza = (n) => `<span class="natureza natureza-${h(n)}">${h(NATUREZAS[n] || n)}</span>`;

const linkFonte = (id) => {
  const f = fontePorId.get(id);
  if (!f) return `<span class="fonte desconhecida">${h(id)}</span>`;
  const rotulo = `${f.veiculo ? f.veiculo + " — " : ""}${f.titulo || f.url}`;
  return `<a class="fonte" href="${h(f.url)}" target="_blank" rel="noopener">${h(rotulo)}</a> <small>(nível ${h(f.nivel)}${f.data ? ", " + dataBR(f.data) : ""})</small>`;
};

// Uma afirmação renderizada do mesmo jeito em qualquer página.
const renderAfirmacao = (a, raiz, { mostrarCasos = true } = {}) => {
  const casosDela = casosDaAfirmacao.get(a.id) || [];
  return `
<article class="afirmacao" id="${h(a.id)}" data-natureza="${h(a.natureza)}" data-divisoes="${h(divisoesDaAfirmacao(a).join(" "))}">
  <header>
    <time datetime="${h(a.data || "")}">${h(dataBR(a.data))}</time>
    ${badgeNatureza(a.natureza)}
    ${a.alegado_por ? `<span class="alegado-por">alegado por ${linkEntidade(a.alegado_por, raiz)}</span>` : ""}
  </header>
  <p class="texto">${h(a.texto)}</p>
  <p class="envolve">Envolve: ${a.envolve.map((id) => linkEntidade(id, raiz)).join(", ")}</p>
  <details class="fontes">
    <summary>Fontes (${a.fontes.length})</summary>
    <ul>${a.fontes.map((id) => `<li>${linkFonte(id)}</li>`).join("")}</ul>
  </details>
  ${a.resposta_do_citado?.texto ? `
  <aside class="resposta">
    <strong>Resposta do citado:</strong> ${h(a.resposta_do_citado.texto)}
    ${a.resposta_do_citado.fonte ? `<br><small>Fonte: ${linkFonte(a.resposta_do_citado.fonte)}</small>` : ""}
  </aside>` : ""}
  ${mostrarCasos && casosDela.length ? `<p class="casos">Casos: ${casosDela.map((c) => linkCaso(c, raiz)).join(", ")}</p>` : ""}
</article>`;
};

// Versão curta, para a árvore: data, natureza, texto e link para a afirmação no caso.
const renderAfirmacaoCurta = (a, caso, raiz) => `
<li class="afirmacao-curta" data-natureza="${h(a.natureza)}">
  <time datetime="${h(a.data || "")}">${h(dataBR(a.data))}</time> ${badgeNatureza(a.natureza)}
  ${h(a.texto)}
  <a href="${raiz}caso/${h(caso.slug)}.html#${h(a.id)}"><small>ver no caso</small></a>
</li>`;

const imagemOuPlaceholder = (c, raiz) => {
  const cor = DIVISOES[c.divisao_principal]?.cor || "#999";
  return c.imagem?.arquivo
    ? `<figure><img src="${raiz}${h(c.imagem.arquivo)}" alt=""><figcaption>${h(c.imagem.credito)} · ${h(c.imagem.licenca)}</figcaption></figure>`
    : `<div class="placeholder" style="--cor:${cor}" role="img" aria-label="Sem imagem"></div>`;
};

// ---------- markdown mínimo (títulos, parágrafos, listas, negrito, links) ----------
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

// ---------- layout base ----------
const CSS = `
:root{--nucleo-master:#9e3535;--politico:#8a4a86;--judiciario:#3a5f9e;--orgao-controle:#2e6f4e;--instituicao-privada:#9a6209}
[hidden]{display:none!important}
body{font-family:system-ui,sans-serif;line-height:1.5;margin:0;max-width:64rem;padding:0 1rem 3rem;margin-inline:auto}
.topo{display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;padding:.75rem 0;border-bottom:1px solid #ccc}
.visualizacoes a{margin-right:.75rem}
.visualizacoes [aria-current]{font-weight:bold;text-decoration:none}
.controles{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
.aviso{background:#fff3cd;border:1px solid #e0c36a;padding:.5rem .75rem;margin:.75rem 0;font-size:.9rem}
.divisao{display:inline-block;padding:0 .4rem;border:1px solid var(--cor);color:var(--cor);border-radius:3px;font-size:.8rem}
.natureza{display:inline-block;padding:0 .4rem;border-radius:3px;font-size:.8rem;background:#eee}
.natureza-alegacao{background:#fde7c8}.natureza-desmentido{background:#f8d0d0}.natureza-decisao{background:#d7e3f5}.natureza-fato{background:#d9efe0}
.afirmacao{border-left:3px solid #ccc;padding:.25rem 0 .25rem 1rem;margin:1rem 0}
.afirmacao header{font-size:.9rem;color:#444;display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
.afirmacao .texto{margin:.35rem 0}
.afirmacao .envolve,.afirmacao .casos{font-size:.9rem;margin:.25rem 0}
.resposta{font-size:.9rem;background:#f5f5f5;padding:.5rem .75rem;margin:.5rem 0}
.placeholder{height:6rem;background:var(--cor,#999);opacity:.25;border-radius:4px;margin:.5rem 0}
a.entidade{text-decoration-color:#999}
.vazio{color:#666;font-style:italic}
/* casos */
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(16rem,1fr));gap:1rem;padding:0;list-style:none}
.card{border:1px solid #ddd;border-radius:6px;padding:.75rem;display:flex;flex-direction:column;gap:.25rem}
.card .placeholder{margin:0}
.card h3{margin:.25rem 0}
.card a{text-decoration:none;color:inherit}
.card a:hover h3{text-decoration:underline}
/* grafo */
#grafo{width:100%;height:32rem;border:1px solid #ddd;border-radius:6px;background:#fafafa}
#grafo .no{cursor:pointer}
#grafo .no text{font-size:.75rem;pointer-events:none;paint-order:stroke;stroke:#fff;stroke-width:3px}
#grafo .aresta{stroke:#999;stroke-opacity:.6}
.legenda{display:flex;gap:.75rem;flex-wrap:wrap;font-size:.85rem;margin:.5rem 0}
.legenda i{display:inline-block;width:.75rem;height:.75rem;border-radius:50%;background:var(--cor);vertical-align:middle;margin-right:.25rem}
/* árvore */
.arvore details{margin:.25rem 0 .25rem 1rem}
.arvore>details{margin-left:0}
.arvore summary{cursor:pointer}
.arvore summary.divisao-titulo{font-weight:bold;color:var(--cor)}
.arvore ul{margin:.25rem 0}
.afirmacao-curta{margin:.25rem 0}
/* busca */
.resultados{border:1px solid #bbb;border-radius:6px;padding:.5rem 1rem;margin:.75rem 0;background:#fff}
.resultados h3{margin:.5rem 0 .25rem;font-size:1rem}
.resultados .trecho{color:#555;font-size:.9rem}
.cabecalho-busca{display:flex;justify-content:space-between;align-items:center;gap:1rem}
/* ligações */
.ligacoes{display:grid;grid-template-columns:repeat(auto-fill,minmax(14rem,1fr));gap:.5rem 1rem}
.ligacoes ul{margin:.25rem 0;padding-left:1.2rem}
`;

// Filtro por divisão: esconde tudo que tem data-divisoes sem a divisão escolhida e avisa a página
// (o grafo escuta esse evento e redesenha). O estado vai na query string para sobreviver à navegação.
const SCRIPT_FILTRO = `
(function(){
  var sel=document.getElementById('filtro-divisao');
  var params=new URLSearchParams(location.search);
  sel.value=params.get('divisao')||'';
  if(sel.value!==(params.get('divisao')||''))sel.value='';
  function aplicar(){
    var d=sel.value;
    document.querySelectorAll('[data-divisoes]').forEach(function(el){
      el.hidden=!!d&&el.dataset.divisoes.split(' ').indexOf(d)<0;
    });
    document.querySelectorAll('nav.visualizacoes a').forEach(function(a){
      var base=a.getAttribute('href').split('?')[0];
      a.setAttribute('href',d?base+'?divisao='+encodeURIComponent(d):base);
    });
    var cont=document.getElementById('contagem-filtro');
    if(cont){var tot=document.querySelectorAll('[data-divisoes]').length,vis=document.querySelectorAll('[data-divisoes]:not([hidden])').length;cont.textContent=d&&tot?vis+' de '+tot:'';}
    document.dispatchEvent(new CustomEvent('filtro-divisao',{detail:d}));
  }
  sel.addEventListener('change',function(){
    var u=new URL(location.href);
    if(sel.value)u.searchParams.set('divisao',sel.value);else u.searchParams.delete('divisao');
    history.replaceState(null,'',u);
    aplicar();
  });
  aplicar();
})();`;


// Busca no cliente: índice em indice-busca.js, sem servidor e sem biblioteca. Normaliza acentos e
// exige que todos os termos apareçam. Combina com o filtro por divisão em vigor.
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

const VISUALIZACOES = [
  ["linha-do-tempo", "Linha do tempo", "index.html"],
  ["casos", "Casos", "casos.html"],
  ["grafo", "Grafo", "grafo.html"],
  ["arvore", "Árvore", "arvore.html"],
];

const pagina = ({ titulo, corpo, profundidade, visualizacao = null, extraHead = "", extraScript = "" }) => {
  const raiz = raizDe(profundidade);
  const vis = VISUALIZACOES.map(([id, nome, arquivo]) =>
    `<a href="${raiz}${arquivo}"${visualizacao === id ? ' aria-current="page"' : ""}>${nome}</a>`).join("");
  const opcoes = Object.entries(DIVISOES).map(([id, d]) => `<option value="${id}">${h(d.nome)}</option>`).join("");
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(titulo)} · Caso Master</title>
<style>${CSS}</style>
<script defer id="indice-busca" src="${raiz}indice-busca.js"></script>
${extraHead}
</head>
<body>
<header class="topo">
  <nav class="visualizacoes" aria-label="Visualização">${vis}</nav>
  <div class="controles">
    <label>Divisão
      <select id="filtro-divisao"><option value="">Todas</option>${opcoes}</select>
    </label>
    <small id="contagem-filtro"></small>
    <form class="busca" role="search" onsubmit="return false">
      <input type="search" name="q" placeholder="Buscar entidades, casos, afirmações" aria-label="Buscar" autocomplete="off" data-raiz="${raiz}">
    </form>
  </div>
</header>
<p class="aviso" role="note">${h(AVISO)}</p>
<section id="resultados-busca" class="resultados" aria-live="polite" hidden></section>
<main>
${corpo}
</main>
<footer><p><small>${h(AVISO)} · <a href="${raiz}index.html">Início</a></small></p></footer>
<script>${SCRIPT_FILTRO}</script>
<script>${SCRIPT_BUSCA}</script>
${extraScript}
</body>
</html>
`;
};

// ---------- visualização 1: linha do tempo (página inicial) ----------
const paginaInicial = () => {
  const sobrePath = join(DADOS, "sobre.md");
  const sobre = existsSync(sobrePath) ? markdown(readFileSync(sobrePath, "utf8")) : "<p>TODO: criar dados/sobre.md</p>";
  const cronologia = [...afirmacoes].sort(porData);
  const raiz = raizDe(0);
  return pagina({
    titulo: "Início",
    profundidade: 0,
    visualizacao: "linha-do-tempo",
    corpo: `
<section class="sobre">${sobre}</section>
<section id="linha-do-tempo">
  <h2>Linha do tempo</h2>
  <p><small>${afirmacoes.length} afirmações · ${casos.length} casos · ${entidades.length} entidades</small></p>
  ${cronologia.map((a) => renderAfirmacao(a, raiz)).join("\n")}
</section>`,
  });
};

// ---------- visualização 2: casos (cards) ----------
const paginaCasos = () => {
  const raiz = raizDe(0);
  const cards = [...casos].sort((a, b) => (b.atualizado_em || "").localeCompare(a.atualizado_em || ""));
  return pagina({
    titulo: "Casos",
    profundidade: 0,
    visualizacao: "casos",
    corpo: `
<h1>Casos</h1>
<ul class="cards">
${cards.map((c) => `
  <li class="card" data-divisoes="${h(c.divisao_principal)}">
    <a href="${raiz}caso/${h(c.slug)}.html">
      ${imagemOuPlaceholder(c, raiz)}
      <h3>${h(c.titulo)}</h3>
      <p>${h(primeiraFrase(c.resumo))}</p>
    </a>
    <p>${badgeDivisao(c.divisao_principal)}</p>
  </li>`).join("")}
</ul>`,
  });
};

// ---------- visualização 3: grafo (D3) ----------
const paginaGrafo = () => {
  const raiz = raizDe(0);
  const legenda = Object.entries(DIVISOES).map(([id, d]) => `<span><i style="--cor:${d.cor}"></i>${h(d.nome)}</span>`).join("");
  return pagina({
    titulo: "Grafo",
    profundidade: 0,
    visualizacao: "grafo",
    extraHead: `<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>`,
    corpo: `
<h1>Grafo de ligações</h1>
<p><small>Cada nó é uma entidade; cada aresta, uma ou mais afirmações que citam as duas. A espessura é o número de afirmações. Clique num nó para abrir a página da entidade; arraste para reorganizar.</small></p>
<div class="legenda">${legenda}</div>
<svg id="grafo" role="img" aria-label="Grafo de entidades"></svg>
<p id="grafo-vazio" class="vazio" hidden>Nenhuma ligação dentro desta divisão.</p>`,
    extraScript: `
<script>
(function(){
  var DADOS=${json(grafo)};
  var CORES=${json(Object.fromEntries(Object.entries(DIVISOES).map(([k, v]) => [k, v.cor])))};
  var RAIZ=${json(raiz)};
  var svg=d3.select('#grafo');
  var sim=null;
  function desenhar(divisao){
    svg.selectAll('*').remove();
    if(sim)sim.stop();
    var nodes=DADOS.nodes.filter(function(n){return !divisao||n.grupo===divisao;}).map(function(n){return Object.assign({},n);});
    var ids=new Set(nodes.map(function(n){return n.id;}));
    var links=DADOS.links.filter(function(l){return ids.has(l.source)&&ids.has(l.target);}).map(function(l){return Object.assign({},l);});
    document.getElementById('grafo-vazio').hidden=nodes.length>0;
    var box=svg.node().getBoundingClientRect(),W=box.width||900,H=box.height||500;
    svg.attr('viewBox',[0,0,W,H]);
    var g=svg.append('g');
    svg.call(d3.zoom().scaleExtent([.4,3]).on('zoom',function(ev){g.attr('transform',ev.transform);}));
    var link=g.append('g').selectAll('line').data(links).join('line').attr('class','aresta')
      .attr('stroke-width',function(l){return 1+l.peso*1.5;});
    link.append('title').text(function(l){return l.peso+' afirmação(ões)';});
    var no=g.append('g').selectAll('g').data(nodes).join('g').attr('class','no')
      .on('click',function(ev,n){location.href=RAIZ+'entidade/'+n.id+'.html';})
      .call(d3.drag()
        .on('start',function(ev,n){if(!ev.active)sim.alphaTarget(.3).restart();n.fx=n.x;n.fy=n.y;})
        .on('drag',function(ev,n){n.fx=ev.x;n.fy=ev.y;})
        .on('end',function(ev,n){if(!ev.active)sim.alphaTarget(0);n.fx=null;n.fy=null;}));
    no.append('circle').attr('r',function(n){return 6+Math.sqrt(n.grau)*3;}).attr('fill',function(n){return CORES[n.grupo]||'#999';})
      .attr('stroke','#fff').attr('stroke-width',1.5);
    no.append('text').attr('dx',function(n){return 8+Math.sqrt(n.grau)*3;}).attr('dy','.35em').text(function(n){return n.nome;});
    no.append('title').text(function(n){return n.nome+' — '+n.grau+' ligação(ões)';});
    sim=d3.forceSimulation(nodes)
      .force('link',d3.forceLink(links).id(function(n){return n.id;}).distance(function(l){return 120-Math.min(l.peso,5)*10;}))
      .force('charge',d3.forceManyBody().strength(-350))
      .force('center',d3.forceCenter(W/2,H/2))
      .force('collide',d3.forceCollide(28))
      .on('tick',function(){
        link.attr('x1',function(l){return l.source.x;}).attr('y1',function(l){return l.source.y;})
            .attr('x2',function(l){return l.target.x;}).attr('y2',function(l){return l.target.y;});
        no.attr('transform',function(n){return 'translate('+n.x+','+n.y+')';});
      });
  }
  document.addEventListener('filtro-divisao',function(ev){desenhar(ev.detail);});
  desenhar(document.getElementById('filtro-divisao').value);
})();
</script>`,
  });
};

// ---------- visualização 4: árvore (divisão → entidade → casos → afirmações) ----------
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
          <summary>${linkCaso(c, raiz)} <small>(${afrs.length})</small></summary>
          <ul>${afrs.map((a) => renderAfirmacaoCurta(a, c, raiz)).join("")}</ul>
        </details>`;
      }).join("") : `<p class="vazio">Sem casos.</p>`;
      return `
      <details>
        <summary>${linkEntidade(e.id, raiz)} <small>(${seusCasos.length} caso${seusCasos.length === 1 ? "" : "s"})</small></summary>
        ${corpoCasos}
      </details>`;
    }).join("") : `<p class="vazio">Nenhuma entidade nesta divisão ainda.</p>`;
    return `
    <details open data-divisoes="${divId}">
      <summary class="divisao-titulo" style="--cor:${d.cor}">${h(d.nome)} <small>(${ents.length})</small></summary>
      ${corpoEnts}
    </details>`;
  }).join("");
  return pagina({
    titulo: "Árvore",
    profundidade: 0,
    visualizacao: "arvore",
    corpo: `
<h1>Árvore</h1>
<p><small>Divisão → entidade → casos → afirmações. Sob cada caso aparecem as afirmações dele que citam a entidade. Clique para expandir ou recolher.</small></p>
<p><button type="button" onclick="document.querySelectorAll('.arvore details').forEach(function(d){d.open=true})">Expandir tudo</button>
   <button type="button" onclick="document.querySelectorAll('.arvore details details').forEach(function(d){d.open=false})">Recolher tudo</button></p>
<div class="arvore">${ramos}</div>`,
  });
};

// ---------- páginas de aprofundamento ----------
const paginaCaso = (c) => {
  const raiz = raizDe(1);
  const afrs = c.afirmacoes.map((id) => afrPorId.get(id)).filter(Boolean).sort(porData);
  const relacionados = (c.casos_relacionados || []).map((id) => casoPorId.get(id)).filter(Boolean);

  // Ligações do caso: entidades citadas nas afirmações, agrupadas por divisão, com nº de afirmações.
  const contagem = new Map();
  for (const a of afrs) for (const id of entidadesDaAfirmacao(a)) contagem.set(id, (contagem.get(id) || 0) + 1);
  const ligacoes = Object.entries(DIVISOES).map(([divId, d]) => {
    const ents = [...contagem].map(([id, n]) => [entPorId.get(id), n]).filter(([e]) => e?.grupo === divId)
      .sort((x, y) => y[1] - x[1] || x[0].nome.localeCompare(y[0].nome));
    return ents.length ? `
    <div>
      ${badgeDivisao(divId)}
      <ul>${ents.map(([e, n]) => `<li>${linkEntidade(e.id, raiz)} <small>(${n})</small></li>`).join("")}</ul>
    </div>` : "";
  }).join("");

  return pagina({
    titulo: c.titulo,
    profundidade: 1,
    corpo: `
<article class="caso">
  <h1>${h(c.titulo)}</h1>
  <p>${badgeDivisao(c.divisao_principal)}</p>
  ${imagemOuPlaceholder(c, raiz)}
  <p class="resumo">${h(c.resumo)}</p>
  <section>
    <h2>Afirmações (${afrs.length})</h2>
    ${afrs.map((a) => renderAfirmacao(a, raiz, { mostrarCasos: false })).join("\n")}
  </section>
  <section>
    <h2>Ligações por divisão</h2>
    <div class="ligacoes">${ligacoes}</div>
  </section>
  ${relacionados.length ? `
  <section>
    <h2>Casos relacionados</h2>
    <ul>${relacionados.map((r) => `<li>${linkCaso(r, raiz)}</li>`).join("")}</ul>
  </section>` : ""}
  <p><small>Registrado em ${h(dataBR(c.registrado_em))} · atualizado em ${h(dataBR(c.atualizado_em))}</small></p>
</article>`,
  });
};

const paginaEntidade = (e) => {
  const raiz = raizDe(1);
  const afrs = afirmacoesDaEntidade(e.id).sort(porData);
  const seusCasos = casosDaEntidade(e.id);
  const vizinhos = grafo.links.filter((l) => l.source === e.id || l.target === e.id)
    .map((l) => [entPorId.get(l.source === e.id ? l.target : l.source), l.peso]).filter(([v]) => v)
    .sort((a, b) => b[1] - a[1]);
  return pagina({
    titulo: e.nome,
    profundidade: 1,
    corpo: `
<article class="entidade-pagina">
  <h1>${h(e.nome)}</h1>
  <p>${badgeDivisao(e.grupo)} <small>${h(e.tipo)}</small></p>
  ${e.descricao ? `<p class="descricao">${h(e.descricao)}</p>` : ""}
  <section>
    <h2>Casos (${seusCasos.length})</h2>
    ${seusCasos.length ? `<ul>${seusCasos.map((c) => `<li>${linkCaso(c, raiz)}</li>`).join("")}</ul>` : `<p class="vazio">Nenhum caso registrado.</p>`}
  </section>
  <section>
    <h2>Ligações (${vizinhos.length})</h2>
    ${vizinhos.length ? `<ul>${vizinhos.map(([v, n]) => `<li>${linkEntidade(v.id, raiz)} ${badgeDivisao(v.grupo)} <small>(${n})</small></li>`).join("")}</ul>` : `<p class="vazio">Nenhuma ligação.</p>`}
  </section>
  <section>
    <h2>Afirmações que envolvem ${h(e.nome)} (${afrs.length})</h2>
    ${afrs.length ? afrs.map((a) => renderAfirmacao(a, raiz)).join("\n") : `<p class="vazio">Nenhuma afirmação registrada.</p>`}
  </section>
</article>`,
  });
};

// ---------- escrita ----------
rmSync(SITE, { recursive: true, force: true });
mkdirSync(join(SITE, "caso"), { recursive: true });
mkdirSync(join(SITE, "entidade"), { recursive: true });

const escreve = (rel, html) => { writeFileSync(join(SITE, rel), html); return rel; };
writeFileSync(join(SITE, "indice-busca.js"), `window.INDICE_BUSCA=${json(indiceBusca)};`);
const geradas = [
  escreve("index.html", paginaInicial()),
  escreve("casos.html", paginaCasos()),
  escreve("grafo.html", paginaGrafo()),
  escreve("arvore.html", paginaArvore()),
  ...casos.map((c) => escreve(join("caso", `${c.slug}.html`), paginaCaso(c))),
  ...entidades.map((e) => escreve(join("entidade", `${e.id}.html`), paginaEntidade(e))),
];

// ---------- verificação de links internos ----------
const arquivosHtml = (dir) =>
  readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? arquivosHtml(p) : p.endsWith(".html") ? [p] : []; });
const quebrados = [];
let internos = 0;
const semScripts = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "");
for (const arq of arquivosHtml(SITE)) {
  const html = semScripts(readFileSync(arq, "utf8"));
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    if (/^(https?:|mailto:|#)/.test(href)) continue;
    internos++;
    const [caminho, ancora] = href.split("#");
    const alvo = resolve(dirname(arq), caminho);
    if (!existsSync(alvo)) { quebrados.push(`${arq.slice(SITE.length + 1)} → ${href}`); continue; }
    if (ancora && !readFileSync(alvo, "utf8").includes(`id="${ancora}"`)) quebrados.push(`${arq.slice(SITE.length + 1)} → ${href} (âncora inexistente)`);
  }
}

for (const it of indiceBusca) {
  const [caminho, ancora] = it.url.split("#");
  const alvo = join(SITE, caminho);
  if (!existsSync(alvo)) quebrados.push(`índice de busca → ${it.url}`);
  else if (ancora && !readFileSync(alvo, "utf8").includes(`id="${ancora}"`)) quebrados.push(`índice de busca → ${it.url} (âncora inexistente)`);
}

console.log(`=== CONSTRUÇÃO ===\n${geradas.length} páginas em site/ (4 visualizações · ${casos.length} casos · ${entidades.length} entidades)`);
console.log(`${grafo.nodes.length} nós · ${grafo.links.length} arestas derivadas`);
console.log(`${indiceBusca.length} registros no índice de busca`);
console.log(`${internos} links internos verificados`);
if (quebrados.length) { console.log("LINKS QUEBRADOS:"); quebrados.forEach((q) => console.log("  ✗ " + q)); }
process.exit(quebrados.length ? 1 : 0);
