// Gera o site estático em site/ a partir de dados/. Sem dependências além do D3 (CDN) no grafo.
// Uso: node construir.mjs  (sai com código 1 se algum link interno estiver quebrado)
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, readdirSync, statSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join, dirname, resolve, sep } from "node:path";
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
const trilhas = existsSync(join(DADOS, "trilhas.json")) ? load("trilhas.json").trilhas : [];

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
const AVISO = "Ninguém citado neste site foi condenado criminalmente até agora.";

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

// Reportar erro: mailto estruturado com o id do registro. O projeto não usa formulários nem
// serviços de terceiros (CLAUDE.md), então o caminho é o cliente de e-mail do próprio leitor.
const reportarErro = (id, raiz) => {
  if (!contatoOk) return "";
  return `<p class="reportar"><a href="${raiz}correcoes.html?registro=${h(id)}">Reportar erro neste registro</a></p>`;
};


// O aviso sai do alto de toda página e passa a acompanhar o conteúdo que ele qualifica: onde há
// afirmações sobre pessoas nomeadas. Continua no rodapé de todas as páginas.
const avisoInline = () => `<p class="aviso-inline" role="note">${h(AVISO)}</p>`;

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
    ${reportarErro(a.id, raiz)}
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
    const listaCasos = casosDaAfirmacao.get(a.id) || [];
    const seusCasos = listaCasos.map((c) => c.slug).join(" ");
    return `
    <article class="marco${novoMes ? " inicio-mes" : ""}" data-mes="${h(mes)}" data-id="${h(a.id)}" data-data="${h(a.data || "")}" data-natureza="${h(a.natureza)}" data-divisoes="${h(divisoesDaAfirmacao(a).join(" "))}" data-casos="${h(seusCasos)}" data-entidades="${h(entidadesDaAfirmacao(a).join(" "))}" tabindex="0" role="button" aria-expanded="false">
      <header>
        <time datetime="${h(a.data || "")}">${h(dataBR(a.data))}</time>
        ${rotuloNatureza(a.natureza)}
        ${conferida(a) ? "" : `<span class="selo nao-conferida" title="Ainda sem revisão humana">não conferida</span>`}
      </header>
      <p class="frase">${h(resumoCurto(a.texto, 190))}</p>
      <p class="quem">${ents}</p>
      <footer class="marco-rodape">
        <span class="marco-caso">${listaCasos.length ? h(resumoCurto(listaCasos[0].titulo, 46)) : "fora de caso"}</span>
        <span class="marco-ler">Ler <span aria-hidden="true">→</span></span>
      </footer>
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

// Texto puro, para subtítulos e resumos: tira negrito e os links [[...]] mantendo o rótulo.
const semMarcacao = (t) => t
  .replace(/\[\[(?:ent|caso):[^\]|]+\|([^\]]+)\]\]/g, "$1")
  .replace(/\[\[(?:ent|caso):([^\]]+)\]\]/g, (m, id) => entPorId.get(id)?.nome || casos.find((c) => c.slug === id)?.titulo || id)
  .replace(/\*\*(.+?)\*\*/g, "$1")
  .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

const markdown = (md, raiz = "./", { extrairTitulo = false } = {}) => {
  const saida = [];
  const capitulos = [];
  const preambulo = [];
  let tituloPrincipal = "";
  // "alvo" recebe o HTML gerado: o preâmbulo até o primeiro capítulo, depois o corpo de cada um.
  let alvo = preambulo;
  let paragrafo = [];
  let lista = null;
  const empurra = (linha) => { saida.push(linha); alvo.push(linha); };
  const fechaParagrafo = () => {
    if (!paragrafo.length) return;
    const cru = paragrafo.join(" ");
    empurra(`<p>${inline(cru, raiz)}</p>`);
    // o primeiro parágrafo de cada capítulo vira o subtítulo do card na página inicial
    const ultimo = capitulos[capitulos.length - 1];
    if (ultimo && !ultimo.texto) ultimo.texto = semMarcacao(cru);
    paragrafo = [];
  };
  const fechaLista = () => { if (lista) { empurra(`<ul>${lista.join("")}</ul>`); lista = null; } };
  for (const linha of md.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    const t = linha.trim();
    const titulo = t.match(/^(#{1,3})\s+(.*?)(?:\s*\{(\d{4}-\d{2})\.\.(\d{4}-\d{2})\})?\s*$/);
    if (titulo) {
      fechaParagrafo(); fechaLista();
      const n = titulo[1].length + 1, id = slugDe(titulo[2]);
      const periodo = titulo[3] ? ` <a class="ver-linha" href="${raiz}linha-do-tempo.html?de=${titulo[3]}&ate=${titulo[4]}#linha-do-tempo" data-de="${titulo[3]}" data-ate="${titulo[4]}">ver na linha do tempo →</a>` : "";
      if (n === 2 && extrairTitulo && !tituloPrincipal) { tituloPrincipal = titulo[2]; continue; }
      if (n === 3) {
        capitulos.push({ id, titulo: titulo[2], de: titulo[3], ate: titulo[4], texto: "", periodo, corpo: [] });
        alvo = capitulos[capitulos.length - 1].corpo;
        saida.push(`<h${n} id="${id}">${inline(titulo[2], raiz)}${periodo}</h${n}>`);
        continue;
      }
      empurra(`<h${n} id="${id}">${inline(titulo[2], raiz)}${periodo}</h${n}>`);
    }
    else if (t.startsWith("- ")) { fechaParagrafo(); (lista ||= []).push(`<li>${inline(t.slice(2), raiz)}</li>`); }
    else if (t === "") { fechaParagrafo(); fechaLista(); }
    else { fechaLista(); paragrafo.push(t); }
  }
  fechaParagrafo(); fechaLista();
  for (const c of capitulos) c.html = c.corpo.join("\n");
  return { html: saida.join("\n"), capitulos, preambulo: preambulo.join("\n"), tituloPrincipal };
};
const lerMd = (nome, padrao) => existsSync(join(DADOS, nome)) ? readFileSync(join(DADOS, nome), "utf8") : padrao;
const sobreHtml = markdown(lerMd("sobre.md", "# Sobre\n\nTODO: criar dados/sobre.md")).html;
const primeiroParagrafo = (sobreHtml.match(/<p>([\s\S]*?)<\/p>/) || [])[1] || "";
const introducaoMd = lerMd("introducao.md", "# O caso\n\nTODO: escrever dados/introducao.md");
const introducao = markdown(introducaoMd, "./", { extrairTitulo: true });
// As páginas de capítulo ficam em capitulo/, um nível abaixo: o mesmo texto precisa ser gerado
// com os caminhos relativos daquela profundidade.
const introducaoFunda = markdown(introducaoMd, "../", { extrairTitulo: true });
const resumoRapido = existsSync(join(DADOS, "resumo-rapido.json")) ? load("resumo-rapido.json").itens : [];
const projeto = existsSync(join(DADOS, "projeto.json")) ? load("projeto.json") : {};

// Metadados de cada capítulo: tempo de leitura estimado e se o assunto ainda está em curso.
// "Em andamento" é derivado, não escrito à mão: o capítulo cobre o mês mais recente da base.
const mesDaBase = () => {
  const datas = afirmacoes.map((a) => a.data).filter(Boolean).sort();
  return (datas[datas.length - 1] || "").slice(0, 7);
};
const MES_ATUAL = mesDaBase();
for (const [i, c] of introducao.capitulos.entries()) {
  const palavras = c.html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  c.minutos = Math.max(1, Math.round(palavras / 200));
  c.emAndamento = !!c.ate && c.ate >= MES_ATUAL;
  c.numero = i + 1;
  c.tituloCurto = c.titulo.replace(/^\d+\.\s*/, "");
  c.arquivo = `capitulo/${c.id}.html`;
}
const contatoOk = projeto.contato && !/^TODO/.test(projeto.contato);
const mantenedorOk = projeto.mantenedor && !/^TODO/.test(projeto.mantenedor);
const linkedinOk = projeto.linkedin && !/^TODO/.test(projeto.linkedin);
const creditoMantenedor = () => !mantenedorOk ? "" :
  linkedinOk ? `<a href="${h(projeto.linkedin)}" target="_blank" rel="noopener me">${h(projeto.mantenedor)}</a>` : h(projeto.mantenedor);

// Data da base: o registro mais recente que existe nos dados, não a hora do build. Assim a data
// exibida significa "conteúdo atualizado até", e não "página gerada de novo".
const dataDaBase = [
  ...casos.flatMap((c) => [c.atualizado_em, c.registrado_em]),
  ...fontes.map((f) => f.acessado_em),
  ...afirmacoes.flatMap((a) => (a.historico || []).map((x) => x.data)),
].filter(Boolean).sort().pop() || "";

// Correções: todo item de histórico das afirmações, do mais recente para o mais antigo.
const correcoes = afirmacoes.flatMap((a) => (a.historico || []).map((x) => ({ ...x, afirmacao: a })))
  .sort((x, y) => (y.data || "").localeCompare(x.data || ""));

// ---------- estilo ----------
const VARS_CLARO = `
  --fundo:#fbfaf7;--superficie:#fff;--texto:#1d1c1a;--texto-suave:#6b675f;--borda:#e4e1da;--borda-forte:#b9b4aa;--link:#2b4c8a;
  --nucleo-master:#9e3535;--politico:#8a4a86;--judiciario:#3a5f9e;--orgao-controle:#2e6f4e;--instituicao-privada:#9a6209;
  --fato:#1d6b41;--decisao:#2f5da3;--alegacao:#b06a00;--desmentido:#b02a2a;--arquivado:#7a766e;`;
const VARS_ESCURO = `
  --fundo:#151514;--superficie:#1d1d1b;--texto:#e8e5df;--texto-suave:#a9a49b;--borda:#2c2b29;--borda-forte:#54514b;--link:#9db7e6;
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
.controles{margin-left:auto;display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;font-size:.88rem;flex:1 1 22rem;justify-content:flex-end;min-width:0}
.controles label{display:flex;gap:.4rem;align-items:center;color:var(--texto-suave)}
.busca{flex:1 1 13rem;min-width:0}
.busca input{width:100%;min-width:0}
#tema{width:2rem;height:2rem;padding:0;line-height:1;font-size:1rem}
.aviso-inline{font-size:.78rem;color:var(--texto-suave);margin:.5rem 0 1.25rem;padding-left:.9rem;border-left:2px solid var(--alegacao);line-height:1.45;max-width:44rem}
footer{margin-top:4rem;padding-top:1rem;border-top:1px solid var(--borda);font-size:.82rem;color:var(--texto-suave)}
/* acessibilidade */
.pular{position:absolute;left:-9999px;top:0;z-index:20;background:var(--texto);color:var(--fundo);padding:.6rem 1rem;border-radius:0 0 4px 0;text-decoration:none}
.pular:focus{left:0}
main:focus{outline:none}
a:focus-visible,button:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--link);outline-offset:2px;border-radius:2px}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}
}
/* guia de entrada (sobreposição) */
.guia{border:1px solid var(--borda);border-radius:10px;background:var(--superficie);color:var(--texto);
  padding:0;width:min(34rem,92vw);max-height:min(34rem,88vh);position:fixed;inset:0;margin:auto;overflow:visible}
.guia::backdrop{background:rgba(20,19,17,.55);backdrop-filter:blur(2px)}
.guia[open]{display:flex;flex-direction:column}
@media (prefers-reduced-motion:no-preference){
  .guia[open]{animation:guia-entra .22s ease-out}
  @keyframes guia-entra{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
}
.guia-fechar{position:absolute;top:.5rem;right:.6rem;z-index:2;width:2rem;height:2rem;padding:0;line-height:1;
  font-size:1.25rem;border-radius:50%;border:1px solid transparent;background:transparent;color:var(--texto-suave)}
.guia-fechar:hover{border-color:var(--borda-forte);color:var(--texto)}
.guia-chapeu{margin:0;padding:1.1rem 3.25rem .25rem 1.5rem;font-size:.74rem;letter-spacing:.08em;text-transform:uppercase;color:var(--texto-suave)}
.guia-trilho{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;outline:none;cursor:grab;flex:1 1 auto;min-height:11rem}
.guia-trilho::-webkit-scrollbar{display:none}
.guia-trilho.arrastando,.guia-trilho.rolando{scroll-snap-type:none}
.guia-trilho.arrastando{cursor:grabbing;user-select:none}
.guia-cartao{flex:0 0 100%;scroll-snap-align:start;padding:.4rem 1.5rem 1rem;overflow-y:auto}
.guia-passo{font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--texto-suave);margin:0 0 .3rem}
.guia-cartao h3{font-size:1.3rem;margin:0 0 .5rem}
.guia-cartao p{margin:.5rem 0;font-size:.95rem;line-height:1.55}
.guia-cartao ul{list-style:none;padding:0;margin:.6rem 0 0}
.guia-cartao ul li{display:grid;grid-template-columns:7.5rem 1fr;gap:.15rem .75rem;align-items:baseline;margin:.4rem 0;font-size:.92rem}
.guia-cartao ul.formas li{grid-template-columns:9rem 1fr}
.guia-cartao ul li span{color:var(--texto-suave)}
.guia-rodape{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.75rem 1.5rem 1.1rem;border-top:1px solid var(--borda)}
.guia-pontos{display:flex;gap:.4rem}
.guia-pontos button{width:.5rem;height:.5rem;padding:0;border-radius:50%;border:1px solid var(--borda-forte);background:transparent}
.guia-pontos button[aria-selected=true]{background:var(--texto);border-color:var(--texto)}
.guia-nav{display:flex;gap:.4rem;align-items:center}
.guia-nav button{padding:.2rem .7rem}
.guia-nav button:disabled{opacity:.3;cursor:default}
.guia-pular{border-color:transparent;color:var(--texto-suave)}
@media (max-width:40rem){
  .guia{width:100%;max-width:100%;max-height:100%;height:100%;border-radius:0;border:none}
  .guia-cartao ul li{grid-template-columns:1fr}
}
/* barra de trilha dentro do caso */
.barra-trilha{background:var(--superficie);border:1px solid var(--borda);border-radius:8px;padding:.8rem 1.1rem;margin:.5rem 0 1.5rem}
.trilha-barra-topo{display:flex;align-items:center;gap:.75rem 1.25rem;flex-wrap:wrap}
.trilha-nome{font-family:var(--serifa);font-weight:600;font-size:1.05rem;color:var(--texto);text-decoration:none}
.trilha-nome:hover{text-decoration:underline;text-decoration-color:var(--borda-forte)}
.trilha-passo{font-size:.82rem;color:var(--texto-suave);font-variant-numeric:tabular-nums}
.trilha-pontos{display:flex;gap:.3rem;margin-left:auto}
.trilha-pontos i{width:.5rem;height:.5rem;border-radius:50%;border:1px solid var(--borda-forte)}
.trilha-pontos i.feito{background:var(--borda-forte)}
.trilha-pontos i.atual{background:var(--texto);border-color:var(--texto);transform:scale(1.25)}
.trilha-barra-nav{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-top:.7rem}
.trilha-ant{font-size:.88rem;color:var(--texto-suave);text-decoration:none}
.trilha-ant:hover{color:var(--texto)}
.trilha-prox{margin:0}
.anterior-proximo.na-trilha{flex-wrap:wrap}
.anterior-proximo.na-trilha .fora-da-trilha{flex-basis:100%;margin:1rem 0 0;text-align:center;font-size:.85rem}
.anterior-proximo.na-trilha .fora-da-trilha a{color:var(--texto-suave)}
.anterior-proximo.na-trilha .fora-da-trilha a:hover{color:var(--texto)}
.filtros-pagina{display:flex;flex-wrap:wrap;gap:.6rem 1.25rem;align-items:center;font-size:.85rem;
  color:var(--texto-suave);margin:1rem 0 0;padding:.7rem 0;border-top:1px solid var(--borda);border-bottom:1px solid var(--borda)}
.filtros-pagina label{display:flex;gap:.4rem;align-items:center}
.filtros-pagina input[type=search]{min-width:12rem}
.filtros-pagina [data-contagem]{margin-left:auto;font-variant-numeric:tabular-nums}
.filtrado{display:none!important}
@media (max-width:44rem){.filtros-pagina [data-contagem]{margin-left:0}}
.nivel-selo{display:inline-block;font-size:.7rem;letter-spacing:.04em;text-transform:uppercase;
  border:1px solid currentColor;border-radius:999px;padding:0 .4rem;margin-right:.35rem}
.nivel-1{color:var(--fato)}.nivel-2{color:var(--decisao)}.nivel-3{color:var(--alegacao)}.nivel-4{color:var(--arquivado)}
.legenda-niveis{list-style:none;padding:0;margin:.75rem 0 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(17rem,1fr));gap:.3rem 1.5rem;font-size:.85rem;color:var(--texto-suave);max-width:60rem}
.lista-entidades{list-style:none;padding:0;margin:1.5rem 0 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr));gap:1rem}
.cartao-entidade{display:flex}
.cartao-entidade>a{display:flex;flex-direction:column;gap:.15rem;width:100%;padding:.9rem 1.1rem 1rem;text-decoration:none;color:inherit;
  background:var(--superficie);border:1px solid var(--borda);border-left:3px solid var(--cor);border-radius:6px;transition:border-color .15s,transform .15s}
.cartao-entidade>a:hover{border-color:var(--borda-forte);border-left-color:var(--cor);transform:translateY(-2px)}
.ent-topo{display:flex;align-items:baseline;justify-content:space-between;gap:.5rem}
.cartao-entidade h3{margin:.2rem 0 .2rem;font-size:1.05rem;line-height:1.25}
.cartao-entidade p{margin:0;font-size:.85rem;color:var(--texto-suave);line-height:1.4;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
@media (prefers-reduced-motion:reduce){.cartao-entidade>a:hover{transform:none}}
/* índice de trilhas */
.cartoes-trilha{list-style:none;padding:0;margin:1.5rem 0 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(18rem,1fr));gap:1.5rem}
.cartao-trilha>a{display:flex;flex-direction:column;height:100%;padding:1.35rem 1.5rem 1.5rem;text-decoration:none;color:inherit;
  border:1px solid var(--borda);border-radius:8px;background:var(--superficie);transition:border-color .15s,transform .15s}
.cartao-trilha>a:hover{border-color:var(--borda-forte);transform:translateY(-2px)}
.cartao-trilha h2{margin:0 0 .3rem;font-size:1.3rem}
.trilha-espia{list-style:none;padding:0;margin:1rem 0 1.25rem;counter-reset:espia;border-top:1px solid var(--borda);padding-top:.8rem}
.trilha-espia li{counter-increment:espia;display:flex;gap:.55rem;font-size:.88rem;color:var(--texto-suave);margin:.3rem 0;line-height:1.35}
.trilha-espia li::before{content:counter(espia);color:var(--borda-forte);font-variant-numeric:tabular-nums}
.cartao-trilha .cap-ler{margin-top:auto}
/* página de uma trilha */
.trilha-pagina{max-width:48rem}
.trilha-chapeu{margin:0;font-size:.74rem;letter-spacing:.08em;text-transform:uppercase;color:var(--texto-suave)}
.trilha-pagina h1{margin:.2rem 0 .5rem}
.trilha-resumo.grande{font-size:1.15rem;max-width:42rem}
.trilha-comecar{margin:1.5rem 0 .5rem}
.botao.grande{padding:.6rem 1.3rem;font-size:1rem;border-color:var(--texto)}
.trilha-sub{font-size:1.05rem;color:var(--texto-suave);font-family:var(--sans);font-weight:400;letter-spacing:.04em;text-transform:uppercase;margin:2.5rem 0 .5rem}
@media (max-width:44rem){
  .trilha-pontos{margin-left:0;width:100%}
  .trilha-barra-nav{flex-direction:column;align-items:stretch}
  .trilha-prox{text-align:center}
}
.pedido-correcao{background:var(--superficie);border:1px solid var(--borda-forte);border-radius:8px;padding:1.25rem 1.5rem 1.4rem;margin:1.5rem 0 2rem;max-width:44rem}
.pedido-correcao h2{margin:0 0 .4rem;font-size:1.2rem}
.pedido-trecho{font-family:var(--serifa);color:var(--texto-suave);margin:0 0 1rem}
.pedido-correcao p{margin:.5rem 0}
.ficha-mantenedor{margin-top:1rem;padding-top:1rem;border-top:1px solid var(--borda);font-size:.95rem}
/* trilhas de leitura */
.lista-trilhas{display:grid;gap:3.5rem;margin:2rem 0 0}
.trilha{max-width:52rem}
.trilha-cabecalho h2{margin:0 0 .25rem;font-size:1.6rem}
.trilha-resumo{font-family:var(--serifa);font-size:1.08rem;color:var(--texto);margin:0 0 .3rem;max-width:44rem}
.trilha-meta{margin:0 0 1.25rem}
.trilha-passos{list-style:none;padding:0;margin:0;counter-reset:passo}
.trilha-passos li{display:grid;grid-template-columns:2.1rem 1fr;gap:0 1rem;padding:0 0 1.35rem;position:relative}
.trilha-passos li::before{content:"";position:absolute;left:1.05rem;top:2.1rem;bottom:0;width:1px;background:var(--borda)}
.trilha-passos li:last-child{padding-bottom:0}
.trilha-passos li:last-child::before{display:none}
.passo-n{display:flex;align-items:center;justify-content:center;width:2.1rem;height:2.1rem;border-radius:50%;
  border:1px solid var(--borda-forte);color:var(--texto-suave);font-size:.82rem;background:var(--fundo)}
.passo-corpo h3{margin:.25rem 0 .2rem;font-size:1.12rem}
.passo-corpo h3 a{color:var(--texto);text-decoration:none}
.passo-corpo h3 a:hover{text-decoration:underline;text-decoration-color:var(--borda-forte)}
.passo-resumo{font-family:var(--serifa);color:var(--texto-suave);margin:0 0 .35rem;font-size:.98rem}
.passo-meta{margin:0;font-size:.85rem}
.trilha-comecar{margin:1.25rem 0 0}
.ir-caminhos{margin:.6rem 0 2rem;font-size:.92rem}
.ir-caminhos a{color:var(--texto)}
@media (min-width:70rem){.lista-trilhas{grid-template-columns:repeat(auto-fit,minmax(24rem,1fr));gap:3.5rem 4rem}}
h1.lede{font-family:var(--serifa);font-size:clamp(1.2rem,2vw,1.55rem);font-weight:400;line-height:1.4;max-width:56rem;margin:0;letter-spacing:0}
.lede-link{margin:.6rem 0 0;font-size:.88rem}
.lede-link a{text-decoration:none;color:var(--texto-suave)}
.lede-link a:hover{color:var(--texto)}
.taxonomia-texto h2 small{display:block;margin:.2rem 0 0;font-size:.88rem;line-height:1.45;max-width:48rem}
.marcas.compacta{grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:.5rem 2rem;margin-top:1rem}
.marcas.compacta div{grid-template-columns:auto;gap:0}
.marcas.compacta dd{font-size:.85rem;line-height:1.4}
/* migalhas, data e correções */
.migalhas{margin:.5rem 0 0;font-size:.82rem}
.migalhas ol{list-style:none;display:flex;flex-wrap:wrap;gap:.35rem;padding:0;margin:0}
.migalhas li+li::before{content:"/";margin-right:.35rem;color:var(--borda-forte)}
.migalhas a{color:var(--texto-suave);text-decoration:none}
.migalhas a:hover{color:var(--texto)}
.migalhas [aria-current]{color:var(--texto-suave)}
.atualizado{margin:.35rem 0 1.25rem;font-size:.8rem;color:var(--texto-suave)}
.atualizado time{font-variant-numeric:tabular-nums}
.reportar{margin:.5rem 0 0;font-size:.82rem}
.reportar a{color:var(--texto-suave)}
.reportar a:hover{color:var(--link)}
.lista-correcoes{list-style:none;padding:0;margin:1rem 0 0;max-width:52rem}
.lista-correcoes li{border-top:1px solid var(--borda);padding:.9rem 0}
.correcao-cabecalho{margin:0 0 .25rem;font-size:.85rem;color:var(--texto-suave)}
.correcao-cabecalho time{font-variant-numeric:tabular-nums;color:var(--texto)}
.correcao-texto{margin:0 0 .35rem;font-family:var(--serifa)}
.correcao-alvo{margin:0;font-size:.9rem}
/* barras de contexto nos números */
.metrica-barra{display:block;height:3px;border-radius:2px;background:var(--borda);margin-top:.6rem;overflow:hidden}
.metrica-barra i{display:block;height:100%;background:var(--texto-suave);border-radius:2px}
/* alvos de toque confortáveis no celular */
@media (max-width:48rem){
  .visualizacoes a,.secundaria a{min-height:44px;display:flex;align-items:center}
  .controles button,.controles select,.controles input{min-height:44px}
  .guia-nav button,.guia-fechar,.faixa-seta{min-width:44px;min-height:44px}
  .faixa-cartao>a{padding:1.1rem 1.15rem}
  .guia-pontos button{width:.7rem;height:.7rem;padding:14px;background-clip:content-box}
}
/* abertura da página inicial */
.oculto{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.abertura{margin:2.5rem 0 3rem}
.abertura .lede{font-family:var(--serifa);font-size:clamp(1.2rem,2vw,1.55rem);line-height:1.4;max-width:56rem;margin:0}
.abertura .lede a{display:block;font-family:var(--sans);font-size:.88rem;margin-top:.6rem;text-decoration:none;color:var(--texto-suave)}
.abertura .lede a:hover{color:var(--texto)}
.secao-cabecalho{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;flex-wrap:wrap}
.secao-link{font-size:.9rem;text-decoration:none;color:var(--texto-suave)}
.secao-link:hover{color:var(--texto)}
/* painel de números */
.painel{margin:0 0 4rem}
.metricas{display:grid;grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr));gap:1px;background:var(--borda);border:1px solid var(--borda);border-radius:8px;overflow:hidden}
.metrica{display:flex;flex-direction:column;gap:.1rem;padding:.95rem clamp(.85rem,2vw,1.2rem);background:var(--superficie);text-decoration:none;color:inherit;transition:background .15s}
.metrica:hover{background:color-mix(in srgb,var(--texto) 4%,var(--superficie))}
.metrica-valor{font-family:var(--serifa);font-size:clamp(1.8rem,3vw,2.3rem);line-height:1;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.metrica-rotulo{font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;color:var(--texto);margin-top:.35rem}
.metrica-nota{font-size:.82rem;color:var(--texto-suave)}
/* resumo em três pontos */
.resumo-rapido{margin:0 0 4rem}
.pontos{list-style:none;padding:0;margin:1.25rem 0 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(17rem,1fr));gap:1.75rem 2.5rem}
.pontos li{border-top:2px solid var(--texto);padding-top:.7rem}
.pontos h3{margin:0 0 .3rem;font-size:1rem;letter-spacing:.02em}
.pontos p{margin:0;font-family:var(--serifa);font-size:1rem;line-height:1.5;color:var(--texto)}
/* destaque das trilhas */
.destaque-trilhas{background:var(--superficie);border:1px solid var(--borda);border-radius:8px;padding:1.75rem 2rem 2rem;margin:0 0 4rem}
.destaque-texto{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:.25rem 1.5rem;margin-bottom:1.25rem}
.destaque-texto h2{margin:0 0 .2rem;grid-column:1}
.destaque-texto p{margin:0;color:var(--texto-suave);max-width:44rem;grid-column:1}
.destaque-texto .secao-link{grid-column:2;grid-row:1 / span 2;align-self:center;white-space:nowrap;
  border:1px solid var(--borda-forte);border-radius:999px;padding:.4rem 1rem}
.destaque-texto .secao-link:hover{border-color:var(--texto);color:var(--texto)}
@media (max-width:44rem){
  .destaque-texto{grid-template-columns:minmax(0,1fr)}
  .destaque-texto .secao-link{grid-column:1;grid-row:auto;justify-self:start;margin-top:.75rem}
}
.trilhas-cta{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:1rem}
.cta{display:flex;flex-direction:column;gap:.25rem;padding:.9rem 1.1rem;border:1px solid var(--borda-forte);border-radius:6px;
  text-decoration:none;color:inherit;background:var(--fundo);transition:border-color .15s,transform .15s}
.cta:hover{border-color:var(--texto);transform:translateY(-2px)}
.cta-titulo{font-family:var(--serifa);font-size:1.1rem;font-weight:600}
.cta-titulo::after{content:" →";color:var(--texto-suave)}
.cta-nota{font-size:.88rem;color:var(--texto-suave);line-height:1.4}
.cta-meta{font-size:.76rem;letter-spacing:.06em;text-transform:uppercase;color:var(--texto-suave);margin-top:.2rem}
/* legenda das marcas */
.taxonomia{margin:0 0 4rem;padding-top:2.25rem;border-top:1px solid var(--borda)}
.taxonomia-texto h2{margin:0 0 .2rem}
.taxonomia-texto p{margin:0 0 1.25rem;color:var(--texto-suave);max-width:48rem}
.marcas{display:grid;grid-template-columns:repeat(auto-fit,minmax(16rem,1fr));gap:.9rem 2rem;margin:0}
.marcas div{display:grid;grid-template-columns:auto;gap:.15rem}
.marcas dt{margin:0}
.marcas dd{margin:0;font-size:.9rem;color:var(--texto-suave);line-height:1.45}
/* grade de capítulos */
.capitulos-grade{margin:0 0 4rem}
.grade-capitulos{list-style:none;padding:0;margin:1.25rem 0 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(16rem,1fr));gap:1rem}
.cap-card{display:flex}
.cap-card>a{display:flex;flex-direction:column;gap:.2rem;width:100%;padding:1.1rem 1.25rem 1.25rem;text-decoration:none;color:inherit;
  border:1px solid var(--borda);border-radius:8px;background:var(--superficie);transition:border-color .15s,transform .15s}
.cap-card>a:hover{border-color:var(--borda-forte);transform:translateY(-2px)}
.cap-n{font-size:.78rem;letter-spacing:.08em;color:var(--texto-suave);font-variant-numeric:tabular-nums}
.cap-card h3{margin:.15rem 0 .3rem;font-size:1.08rem;line-height:1.25}
.cap-card p{margin:0 0 .9rem;font-size:.9rem;color:var(--texto-suave);line-height:1.45;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cap-ler{margin-top:auto;font-size:.85rem;color:var(--link)}
/* chamada do grafo e da árvore */
.explorar{margin:0 0 2rem;padding-top:2.25rem;border-top:1px solid var(--borda)}
.explorar-cartoes{display:grid;grid-template-columns:repeat(auto-fit,minmax(19rem,1fr));gap:1.5rem;margin-top:1.25rem}
.explorar-cartao{display:flex;flex-direction:column;padding:1.25rem;border:1px solid var(--borda);border-radius:8px;
  background:var(--superficie);text-decoration:none;color:inherit;transition:border-color .15s,transform .15s}
.explorar-cartao:hover{border-color:var(--borda-forte);transform:translateY(-2px)}
.mini-caixa{background:var(--fundo);border:1px solid var(--borda);border-radius:6px;margin-bottom:1rem;overflow:hidden}
.mini{display:block;width:100%;height:auto}
.mini-arestas line{stroke:var(--borda-forte);stroke-opacity:.75}
.explorar-cartao h3{margin:0 0 .35rem;font-size:1.25rem}
.explorar-cartao p{margin:0 0 1rem;font-size:.92rem;color:var(--texto-suave);line-height:1.5}
@media (prefers-reduced-motion:reduce){.cta:hover,.cap-card>a:hover,.explorar-cartao:hover{transform:none}}
@media (max-width:40rem){
  .destaque-trilhas{padding:1.25rem 1.1rem 1.4rem}
  .grade-capitulos{grid-template-columns:repeat(auto-fill,minmax(13rem,1fr));gap:.75rem}
  .cap-card>a{padding:.9rem 1rem 1rem}
  .metrica-valor{font-size:2rem}
}
/* faixa de capítulos */
.faixa{margin:2.5rem 0 2rem}
.faixa-cabecalho{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;flex-wrap:wrap}
.faixa-cabecalho h2{margin:0}
.faixa-controles{display:flex;align-items:center;gap:.5rem}
.faixa-posicao{margin:0;font-size:.82rem;color:var(--texto-suave);font-variant-numeric:tabular-nums}
.faixa-seta{min-width:2.2rem;padding:.25rem .7rem}
.faixa-seta:disabled{opacity:.3;cursor:default}
.faixa-trilho{display:flex;gap:1.25rem;list-style:none;padding:1.25rem 0 .5rem;margin:0 calc(-1 * var(--margem));
  padding-inline:var(--margem);overflow-x:auto;scroll-snap-type:x proximity;scroll-padding-inline-start:var(--margem);
  scrollbar-width:none;outline:none;cursor:grab}
.faixa-trilho::-webkit-scrollbar{display:none}
.faixa-trilho.arrastando{cursor:grabbing;user-select:none}
.faixa-trilho.arrastando,.faixa-trilho.rolando{scroll-snap-type:none}
.faixa-trilho:focus-visible{box-shadow:inset 0 0 0 1px var(--borda-forte);border-radius:4px}
.faixa-cartao{flex:0 0 calc((100% - 2.5rem)/3);scroll-snap-align:start;display:flex}
.faixa-cartao>a{display:flex;flex-direction:column;gap:.3rem;width:100%;min-height:11.5rem;padding:1rem 1.15rem 1.1rem;
  text-decoration:none;color:inherit;border:1px solid var(--borda);border-radius:8px;background:var(--superficie);
  transition:border-color .15s,transform .15s}
.faixa-cartao>a:hover{border-color:var(--borda-forte);transform:translateY(-2px)}
.faixa-cartao.atual>a{border-color:var(--texto)}
.cap-topo{display:flex;align-items:center;justify-content:space-between;gap:.5rem}
.faixa-cartao .cap-n{font-size:.78rem;letter-spacing:.08em;color:var(--texto-suave);font-variant-numeric:tabular-nums}
.cap-titulo{font-family:var(--serifa);font-weight:600;font-size:1.08rem;line-height:1.25;margin:.1rem 0 .15rem}
.cap-resumo{font-size:.88rem;color:var(--texto-suave);line-height:1.45;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.cap-rodape{display:flex;align-items:baseline;justify-content:space-between;gap:.5rem;margin-top:auto;padding-top:.65rem}
.cap-tempo{font-size:.78rem;color:var(--texto-suave)}
.selo-andamento{font-size:.7rem;letter-spacing:.05em;text-transform:uppercase;color:var(--alegacao);
  border:1px solid currentColor;border-radius:999px;padding:0 .45rem;white-space:nowrap}
.ler-tudo{margin:1.5rem 0 0;font-size:.92rem}
.ler-tudo a{color:var(--texto-suave)}
.ler-tudo a:hover{color:var(--texto)}
.entenda-resumo{margin-bottom:.5rem}
/* leitura focada de um capítulo */
.capitulo-progresso{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;margin:0 0 .35rem;font-size:.82rem;color:var(--texto-suave)}
.progresso-texto{font-variant-numeric:tabular-nums;color:var(--texto)}
.progresso-barra{flex:1 1 6rem;min-width:5rem;height:3px;background:var(--borda);border-radius:2px;overflow:hidden}
.progresso-barra i{display:block;height:100%;background:var(--texto-suave)}
.capitulo-texto h1{margin:.2rem 0 .4rem}
.capitulo-periodo{margin:0 0 1.5rem;font-size:.88rem}
.capitulo-nav{display:grid;grid-template-columns:1fr auto 1fr;gap:1rem;align-items:start;
  margin:3rem 0 0;padding-top:1.5rem;border-top:1px solid var(--borda);font-size:.95rem}
.capitulo-nav a{text-decoration:none;color:var(--texto)}
.capitulo-nav a:hover{text-decoration:underline;text-decoration-color:var(--borda-forte)}
.capitulo-nav small{display:block;color:var(--texto-suave);margin-bottom:.1rem}
.nav-proximo{text-align:right}
.nav-todos{align-self:center;white-space:nowrap;color:var(--texto-suave)!important;font-size:.88rem}
.indice-capitulos ol{list-style:none;padding:0;margin:0;font-size:.9rem}
.indice-capitulos li{margin:.3rem 0}
.indice-capitulos a{display:flex;gap:.5rem;color:var(--texto-suave);text-decoration:none}
.indice-capitulos a span{font-variant-numeric:tabular-nums;color:var(--borda-forte)}
.indice-capitulos a:hover{color:var(--texto)}
.indice-capitulos [aria-current] a{color:var(--texto);font-weight:600}
/* versão contínua: ritmo entre capítulos, sem caixa pesada */
.cap-longo{margin:3.5rem 0 0;padding-top:2rem;border-top:1px solid var(--borda);scroll-margin-top:5rem}
.cap-longo-meta{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;margin:0 0 .25rem;font-size:.8rem;color:var(--texto-suave)}
.cap-longo-meta .cap-n{letter-spacing:.08em;font-variant-numeric:tabular-nums}
.cap-longo h2{margin:.1rem 0 .3rem}
.cap-longo-link{margin:1.25rem 0 0;font-size:.88rem}
.cap-longo-link a{color:var(--texto-suave)}
.cap-longo-link a:hover{color:var(--texto)}
@media (max-width:64rem){.faixa-cartao{flex-basis:calc((100% - 1.25rem)/2)}}
@media (max-width:44rem){
  .faixa-cartao{flex-basis:86%}
  .faixa-cartao>a{min-height:auto}
  .capitulo-nav{grid-template-columns:1fr;gap:1.25rem}
  .nav-proximo{text-align:left}
  .nav-todos{justify-self:start}
}
/* narrativa completa */
.introducao{display:grid;grid-template-columns:minmax(0,1fr);gap:2.5rem;margin:1.5rem 0 0}
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
.marco{flex:0 0 clamp(16rem,22vw,19.5rem);display:flex;flex-direction:column;position:relative;
  margin-top:1.6rem;padding:1.1rem 1.25rem 1.1rem;scroll-snap-align:start;cursor:pointer;
  background:var(--superficie);border:1px solid var(--borda);border-radius:8px;
  transition:border-color .15s,transform .15s,box-shadow .15s}
.marco:hover{border-color:var(--borda-forte);transform:translateY(-2px)}
.marco::before{content:"";position:absolute;top:-1.3rem;left:1.25rem;right:calc(-1.5rem - 1.25rem);height:1px;background:var(--borda)}
.marco:last-child::before{right:1.25rem}
.marco::after{content:"";position:absolute;top:calc(-1.3rem - .3rem);left:1.25rem;width:.65rem;height:.65rem;
  border-radius:50%;background:var(--cor,var(--borda-forte));box-shadow:0 0 0 3px var(--fundo);transition:transform .15s}
.marco:hover::after,.marco.aberto::after{transform:scale(1.45)}
.marco.inicio-mes header::before{position:absolute;top:-2.9rem;left:1.25rem;font-size:.72rem;letter-spacing:.06em;
  text-transform:uppercase;color:var(--texto-suave);white-space:nowrap;content:attr(data-mes)}
.marco header{position:static;font-size:.8rem;color:var(--texto-suave);display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
.marco header time{font-variant-numeric:tabular-nums;color:var(--texto);font-weight:600}
.marco header .selo{margin-left:auto;font-size:.68rem}
.marco .frase{font-family:var(--serifa);font-size:1rem;line-height:1.45;margin:.5rem 0 .55rem;color:var(--texto)}
.marco .quem{margin:0 0 .75rem;font-size:.8rem;line-height:1.7}
.marco .quem a.entidade{margin-right:.5rem}
.marco-rodape{display:flex;align-items:baseline;justify-content:space-between;gap:.75rem;margin-top:auto;
  padding-top:.65rem;border-top:1px solid var(--borda);font-size:.78rem;color:var(--texto-suave)}
.marco-caso{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.marco-ler{color:var(--link);white-space:nowrap}
.marco.aberto{border-color:var(--cor,var(--texto));box-shadow:inset 3px 0 0 var(--cor,var(--borda-forte))}
.marco[data-natureza=fato]{--cor:var(--fato)}.marco[data-natureza=decisao]{--cor:var(--decisao)}
.marco[data-natureza=alegacao]{--cor:var(--alegacao)}.marco[data-natureza=desmentido]{--cor:var(--desmentido)}
@media (prefers-reduced-motion:reduce){.marco:hover{transform:none}}
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
@media (min-width:64rem){.introducao{grid-template-columns:minmax(0,1fr) 17rem;justify-content:space-between;gap:5rem}.introducao .intro-texto{max-width:70rem}}
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
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(18rem,1fr));gap:1.5rem;padding:0;list-style:none;margin:1.5rem 0}
.card{display:flex}
.card>a{display:flex;flex-direction:column;width:100%;text-decoration:none;color:inherit;overflow:hidden;
  background:var(--superficie);border:1px solid var(--borda);border-radius:8px;
  transition:border-color .15s,transform .15s,box-shadow .15s}
.card>a:hover{border-color:var(--cor);transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,.06)}
.card-faixa{display:block;height:5px;background:var(--cor)}
.card .corpo{padding:1.1rem 1.25rem .25rem}
.card-divisao{margin:0 0 .45rem}
.card h3{margin:0 0 .45rem;font-size:1.18rem;line-height:1.25}
.card-resumo{margin:0;font-size:.95rem;color:var(--texto-suave);line-height:1.5;
  display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.card-rodape{display:flex;align-items:baseline;justify-content:space-between;gap:.75rem;
  margin-top:auto;padding:.9rem 1.25rem 1.1rem;font-size:.82rem;color:var(--texto-suave)}
.card>a:hover h3{text-decoration:underline;text-decoration-color:var(--cor)}
@media (prefers-reduced-motion:reduce){.card>a:hover{transform:none}}
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
.painel-viz{list-style:none;padding:0;margin:.5rem 0 0}
.painel-viz li{margin:.15rem 0}
.ver-ligacao{border:none;background:transparent;padding:.15rem 0;text-align:left;color:var(--texto);font-size:.9rem;width:100%;border-radius:3px}
.ver-ligacao:hover{color:var(--link)}
.ver-ligacao[aria-expanded=true]{color:var(--link);font-weight:600}
.painel-afirmacoes{margin-top:.75rem;padding-top:.6rem;border-top:1px solid var(--borda);max-height:14rem;overflow-y:auto}
.painel-afirmacoes h4{margin:0 0 .35rem;font-family:var(--sans);font-size:.75rem;letter-spacing:.06em;text-transform:uppercase;color:var(--texto-suave);font-weight:400}
.painel-afirmacoes ul{list-style:none;padding:0;margin:0}
.painel-afirmacoes li{margin:0 0 .6rem;font-size:.85rem;line-height:1.4}
.painel-afirmacoes time{display:inline-block;margin-left:.4rem;color:var(--texto-suave);font-variant-numeric:tabular-nums}
.painel-afirmacoes a{display:block;margin-top:.15rem;color:var(--texto);text-decoration:none;border-bottom:1px solid var(--borda)}
.painel-afirmacoes a:hover{color:var(--link)}
.naturezas{display:flex;flex-direction:column;gap:.2rem;margin:.25rem 0 .5rem}
.ck{display:flex;align-items:center;gap:.4rem;font-size:.85rem;cursor:pointer}
.ck input{margin:0}
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
.resultados mark{background:color-mix(in srgb,var(--alegacao) 30%,transparent);color:inherit;border-radius:2px;padding:0 .1em}
.cabecalho-busca{display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap}
/* páginas de aprofundamento: coluna de leitura + lateral */
.duas-colunas{display:grid;grid-template-columns:minmax(0,1fr);gap:3rem}
@media (min-width:64rem){
  .duas-colunas{grid-template-columns:minmax(0,1fr) 20rem;justify-content:space-between;gap:5rem}
  .duas-colunas .prosa{max-width:70rem}
  .lateral{position:sticky;top:5rem;align-self:start;max-height:calc(100vh - 6rem);overflow-y:auto;
    overscroll-behavior:contain;scrollbar-width:thin;padding-right:.5rem;margin-right:-.5rem}
  .intro-lateral{position:sticky;top:5rem;align-self:start;max-height:calc(100vh - 6rem);overflow-y:auto;
    overscroll-behavior:contain;scrollbar-width:thin}
}
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
(function(){var q=new URLSearchParams(location.search),t=q.get('tema');if(t==='claro'||t==='escuro')document.documentElement.dataset.tema=t;if(q.get('guia')==='0')document.documentElement.dataset.guia='0';})();`;

// Estado de navegação (divisão e tema): filtro por divisão, botão de tema e propagação dos
// parâmetros para todos os links internos, para que a escolha sobreviva à navegação.
const SCRIPT_ESTADO = `
(function(){
  var sel=document.getElementById('filtro-divisao');
  var botaoTema=document.getElementById('tema');
  var params=new URLSearchParams(location.search);
  sel.value=params.get('divisao')||'';
  if(sel.value!==(params.get('divisao')||''))sel.value='';
  function estado(){var p=new URLSearchParams();if(sel.value)p.set('divisao',sel.value);var t=document.documentElement.dataset.tema;if(t)p.set('tema',t);if(document.documentElement.dataset.guia==='0')p.set('guia','0');var s=p.toString();return s?'?'+s:'';}
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
    if(document.documentElement.dataset.guia==='0')u.set('guia','0');
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
  // Janela de texto em volta do primeiro termo encontrado, para o leitor ver por que aquilo bateu.
  function trecho(texto,termos){
    var n=norm(texto),i=-1;
    for(var k=0;k<termos.length&&i<0;k++)i=n.indexOf(termos[k]);
    if(i<0)return texto.length>150?texto.slice(0,150)+'…':texto;
    var ini=Math.max(0,i-60),fim=Math.min(texto.length,i+110);
    return (ini?'…':'')+texto.slice(ini,fim).trim()+(fim<texto.length?'…':'');
  }
  // Marca os termos sem quebrar acentuação: compara na versão normalizada, corta na original.
  function realce(texto,termos){
    var n=norm(texto),faixas=[];
    termos.forEach(function(t){
      for(var i=n.indexOf(t);i>=0;i=n.indexOf(t,i+t.length))faixas.push([i,i+t.length]);
    });
    if(!faixas.length)return esc(texto);
    faixas.sort(function(a,b){return a[0]-b[0];});
    var saida='',pos=0;
    faixas.forEach(function(f){
      if(f[0]<pos)return;
      saida+=esc(texto.slice(pos,f[0]))+'<mark>'+esc(texto.slice(f[0],f[1]))+'</mark>';
      pos=f[1];
    });
    return saida+esc(texto.slice(pos));
  }
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
        html+='<li><a href="'+RAIZ+esc(it.url)+'">'+realce(it.titulo,termos)+'</a>'+(it.t==='entidade'?'':' — <span class="trecho">'+realce(trecho(it.texto,termos),termos)+'</span>')+'</li>';
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

const SCRIPT_GUIA = `
(function(){
  var dlg=document.getElementById('guia');
  var trilho=document.querySelector('.guia-trilho');
  if(!dlg||!trilho)return;
  var cartoes=Array.prototype.slice.call(trilho.querySelectorAll('.guia-cartao'));
  var pontos=Array.prototype.slice.call(document.querySelectorAll('.guia-pontos button'));
  var setas=document.querySelectorAll('.guia-nav button');
  var suave=!window.matchMedia||!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Cada cartão ocupa a largura inteira do trilho, então a posição é só indice*largura. Guardamos o
  // índice em vez de deduzi-lo da rolagem: medir durante a animação dava saltos e cliques perdidos.
  var idx=0,anim=null;
  function largura(){return trilho.clientWidth;}
  function marcar(){
    pontos.forEach(function(b,j){b.setAttribute('aria-selected',j===idx?'true':'false');});
    setas[0].disabled=idx===0;setas[1].disabled=idx===cartoes.length-1;
  }
  function irPara(i,instantaneo){
    idx=Math.max(0,Math.min(cartoes.length-1,i));
    marcar();
    var alvo=idx*largura();
    if(anim){cancelAnimationFrame(anim);anim=null;}
    if(instantaneo||!suave){trilho.classList.remove('rolando');trilho.scrollLeft=alvo;return;}
    var ini=trilho.scrollLeft,dist=alvo-ini,t0=performance.now();
    if(!dist)return;
    trilho.classList.add('rolando');
    (function passo(t){
      var q=Math.min(1,(t-t0)/320),e=1-Math.pow(1-q,3);
      trilho.scrollLeft=ini+dist*e;
      if(q<1){anim=requestAnimationFrame(passo);}
      else{anim=null;trilho.scrollLeft=alvo;trilho.classList.remove('rolando');}
    })(t0);
  }
  setas.forEach(function(b){b.addEventListener('click',function(){irPara(idx+Number(b.dataset.dir));});});
  pontos.forEach(function(b){b.addEventListener('click',function(){irPara(Number(b.dataset.i));});});
  trilho.addEventListener('keydown',function(ev){
    if(ev.key==='ArrowRight'){irPara(idx+1);ev.preventDefault();}
    if(ev.key==='ArrowLeft'){irPara(idx-1);ev.preventDefault();}
  });
  dlg.addEventListener('keydown',function(ev){
    if(ev.target.closest('button')||ev.target===trilho)return;
    if(ev.key==='ArrowRight')irPara(idx+1);
    if(ev.key==='ArrowLeft')irPara(idx-1);
  });
  trilho.addEventListener('wheel',function(ev){
    if(Math.abs(ev.deltaX)>Math.abs(ev.deltaY)){ev.preventDefault();if(Math.abs(ev.deltaX)>18)irPara(idx+(ev.deltaX>0?1:-1));}
  },{passive:false});
  // Arrastar: solta no cartão mais próximo do deslocamento feito.
  var x0=null,s0=0,moveu=false;
  trilho.addEventListener('pointerdown',function(ev){
    if(ev.button!==0||ev.target.closest('a,button'))return;
    if(anim){cancelAnimationFrame(anim);anim=null;}
    x0=ev.clientX;s0=trilho.scrollLeft;moveu=false;trilho.classList.add('arrastando','rolando');
  });
  window.addEventListener('pointermove',function(ev){
    if(x0===null)return;var dx=ev.clientX-x0;if(Math.abs(dx)>4)moveu=true;
    trilho.scrollLeft=Math.max(0,Math.min((cartoes.length-1)*largura(),s0-dx));
  });
  window.addEventListener('pointerup',function(){
    if(x0===null)return;
    x0=null;trilho.classList.remove('arrastando');
    irPara(Math.round(trilho.scrollLeft/largura()));
  });
  trilho.addEventListener('click',function(ev){if(moveu){ev.preventDefault();ev.stopPropagation();moveu=false;}},true);
  window.addEventListener('resize',function(){irPara(idx,true);});
  // Abertura e fechamento. Sem localStorage: quem fecha leva guia=0 na URL, como tema e divisão.
  function encerrar(){
    document.documentElement.dataset.guia='0';
    var u=new URL(location.href);u.searchParams.set('guia','0');history.replaceState(null,'',u);
    if(dlg.open)dlg.close();
  }
  document.getElementById('guia-fechar').addEventListener('click',encerrar);
  document.getElementById('guia-pular').addEventListener('click',encerrar);
  dlg.addEventListener('close',encerrar);
  dlg.addEventListener('click',function(ev){if(ev.target===dlg)encerrar();});
  marcar();
  if(document.documentElement.dataset.guia!=='0'&&dlg.showModal){dlg.showModal();irPara(0,true);}
})();`;

// Faixa de capítulos: rolagem horizontal com setas, teclado e arrasto. Sem avanço automático.
// Como no guia, animamos à mão porque scrollTo suave não avança com scroll-snap mandatory.
const SCRIPT_FAIXA = `
(function(){
  var trilho=document.getElementById('faixa-trilho');
  if(!trilho)return;
  var cartoes=Array.prototype.slice.call(trilho.querySelectorAll('.faixa-cartao'));
  var setas=Array.prototype.slice.call(document.querySelectorAll('.faixa-seta'));
  var posicao=document.getElementById('faixa-posicao');
  var suave=!window.matchMedia||!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var anim=null;
  function passo(){var a=cartoes[0],b=cartoes[1];return b?b.offsetLeft-a.offsetLeft:a.offsetWidth;}
  function visiveis(){return Math.max(1,Math.round(trilho.clientWidth/passo()));}
  function indice(){return Math.round(trilho.scrollLeft/passo());}
  function marcar(){
    var i=indice(),n=cartoes.length,ate=Math.min(n,i+visiveis());
    if(posicao)posicao.textContent=(i+1===ate?'Capítulo '+ate:'Capítulos '+(i+1)+' a '+ate)+' de '+n;
    setas[0].disabled=trilho.scrollLeft<4;
    setas[1].disabled=trilho.scrollLeft>=trilho.scrollWidth-trilho.clientWidth-4;
  }
  function irPara(i){
    i=Math.max(0,Math.min(cartoes.length-1,i));
    var alvo=Math.min(i*passo(),trilho.scrollWidth-trilho.clientWidth);
    if(anim){cancelAnimationFrame(anim);anim=null;}
    if(!suave){trilho.scrollLeft=alvo;marcar();return;}
    var ini=trilho.scrollLeft,dist=alvo-ini,t0=performance.now();
    if(!dist){marcar();return;}
    trilho.classList.add('rolando');
    (function anda(t){
      var q=Math.min(1,(t-t0)/320),e=1-Math.pow(1-q,3);
      trilho.scrollLeft=ini+dist*e;
      if(q<1)anim=requestAnimationFrame(anda);
      else{anim=null;trilho.scrollLeft=alvo;trilho.classList.remove('rolando');marcar();}
    })(t0);
  }
  setas.forEach(function(b){b.addEventListener('click',function(){irPara(indice()+Number(b.dataset.dir));});});
  trilho.addEventListener('keydown',function(ev){
    if(ev.key==='ArrowRight'){irPara(indice()+1);ev.preventDefault();}
    if(ev.key==='ArrowLeft'){irPara(indice()-1);ev.preventDefault();}
    if(ev.key==='Home'){irPara(0);ev.preventDefault();}
    if(ev.key==='End'){irPara(cartoes.length-1);ev.preventDefault();}
  });
  trilho.addEventListener('scroll',function(){clearTimeout(window.__f);window.__f=setTimeout(marcar,90);});
  var x0=null,s0=0,moveu=false;
  trilho.addEventListener('pointerdown',function(ev){
    if(ev.button!==0||ev.target.closest('a,button'))return;
    if(anim){cancelAnimationFrame(anim);anim=null;}
    x0=ev.clientX;s0=trilho.scrollLeft;moveu=false;trilho.classList.add('arrastando','rolando');
  });
  window.addEventListener('pointermove',function(ev){
    if(x0===null)return;var dx=ev.clientX-x0;if(Math.abs(dx)>4)moveu=true;trilho.scrollLeft=s0-dx;
  });
  window.addEventListener('pointerup',function(){
    if(x0===null)return;x0=null;trilho.classList.remove('arrastando');irPara(indice());
  });
  trilho.addEventListener('click',function(ev){if(moveu){ev.preventDefault();ev.stopPropagation();moveu=false;}},true);
  window.addEventListener('resize',function(){clearTimeout(window.__fr);window.__fr=setTimeout(marcar,150);});
  // o cartão que tem foco entra no campo de visão, para o teclado não "perder" o item
  cartoes.forEach(function(c,i){c.querySelector('a').addEventListener('focus',function(){
    var esq=c.offsetLeft-trilho.scrollLeft;
    if(esq<0||esq+c.offsetWidth>trilho.clientWidth)irPara(i);
  });});
  marcar();
})();`;

// Barra de trilha nas páginas de caso. O caso é a página canônica e não pertence a trilha nenhuma;
// quando o leitor chega por uma, os parâmetros na URL dizem qual é e em que passo ele está, e a
// barra oferece o passo seguinte. Sem parâmetro, nada aparece.
const SCRIPT_TRILHA = `
(function(){
  var barra=document.getElementById('barra-trilha');
  if(!barra||!window.TRILHAS)return;
  var q=new URLSearchParams(location.search),id=q.get('trilha');
  if(!id)return;
  var t=window.TRILHAS.filter(function(x){return x.id===id;})[0];
  if(!t)return;
  var slug=barra.dataset.slug,i=t.casos.indexOf(slug);
  if(i<0)i=Math.max(0,(parseInt(q.get('passo'),10)||1)-1);
  var raiz=barra.dataset.raiz;
  function url(j){return raiz+'caso/'+t.casos[j]+'.html?trilha='+encodeURIComponent(t.id)+'&passo='+(j+1);}
  function esc(x){return String(x).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  var ant=i>0?'<a class="trilha-ant" href="'+url(i-1)+'">← '+esc(t.titulos[i-1])+'</a>':'<span></span>';
  var prox=i<t.casos.length-1
    ? '<a class="trilha-prox botao" href="'+url(i+1)+'">Próximo: '+esc(t.titulos[i+1])+' →</a>'
    : '<a class="trilha-prox botao" href="'+raiz+'trilha/'+t.id+'.html">Fim da trilha · rever os passos →</a>';
  barra.innerHTML=
    '<div class="trilha-barra-topo">'
      +'<a class="trilha-nome" href="'+raiz+'trilha/'+t.id+'.html">Trilha: '+esc(t.titulo)+'</a>'
      +'<span class="trilha-passo">Passo '+(i+1)+' de '+t.casos.length+'</span>'
      +'<span class="trilha-pontos" aria-hidden="true">'+t.casos.map(function(_,j){
          return '<i class="'+(j<i?'feito':(j===i?'atual':''))+'"></i>';}).join('')+'</span>'
    +'</div>'
    +'<div class="trilha-barra-nav">'+ant+prox+'</div>';
  barra.hidden=false;
  document.documentElement.dataset.trilha=t.id;

  // Dentro de uma trilha, o rodapé do caso deixa de oferecer o vizinho cronológico e passa a
  // oferecer o passo da trilha: sair para um caso sem relação no meio do percurso confunde.
  var rodape=document.querySelector('.anterior-proximo');
  if(!rodape)return;
  var antHtml=i>0
    ? '<a class="anterior" href="'+url(i-1)+'"><small>← Passo '+i+' da trilha</small>'+esc(t.titulos[i-1])+'</a>'
    : '<a class="anterior" href="'+raiz+'trilha/'+t.id+'.html"><small>← Início da trilha</small>'+esc(t.titulo)+'</a>';
  var proxHtml=i<t.casos.length-1
    ? '<a class="proximo" href="'+url(i+1)+'"><small>Passo '+(i+2)+' da trilha →</small>'+esc(t.titulos[i+1])+'</a>'
    : '<a class="proximo" href="'+raiz+'trilha/'+t.id+'.html"><small>Fim da trilha →</small>Rever os passos</a>';
  rodape.classList.add('na-trilha');
  rodape.setAttribute('aria-label','Navegação dentro da trilha '+t.titulo);
  rodape.innerHTML=antHtml+proxHtml
    +'<p class="fora-da-trilha"><a href="'+raiz+'caso/'+slug+'.html">Sair da trilha e ver este caso sozinho</a></p>';
})();`;

// Pedido de correção: o botão de cada registro traz o leitor para cá com ?registro=<id>. O e-mail
// do mantenedor existe só nesta página, não nas 93 que listam afirmações, para reduzir a coleta
// automática de endereços.
const SCRIPT_PEDIDO = `
(function(){
  var caixa=document.getElementById('pedido-correcao');
  if(!caixa||!window.REGISTROS)return;
  var id=new URLSearchParams(location.search).get('registro');
  if(!id)return;
  var r=window.REGISTROS[id];
  function esc(x){return String(x).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  var assunto=encodeURIComponent('Correção no registro '+id);
  var corpo=encodeURIComponent(
    'Registro: '+id+'\\n'+
    (r?'Página: '+window.SITE+'/'+r.u+'\\n':'')+
    (r?'Texto atual: '+r.t+'\\n':'')+
    '\\nO que está errado:\\n\\n'+
    'Fonte que sustenta a correção (com link):\\n\\n');
  caixa.innerHTML='<h2>Reportar erro neste registro</h2>'
    +(r?'<p class="pedido-trecho">'+esc(r.t)+' <a href="'+r.u+'">ver o registro →</a></p>':'<p class="pedido-trecho">Registro <code>'+esc(id)+'</code></p>')
    +'<p><a class="botao grande" href="mailto:'+window.CONTATO+'?subject='+assunto+'&body='+corpo+'">Escrever para o mantenedor →</a></p>'
    +'<p><small>A mensagem já vai preenchida com o identificador do registro e o link da página. Descreva o erro e, se possível, informe a fonte que sustenta a correção.</small></p>';
  caixa.hidden=false;
  caixa.scrollIntoView({block:'nearest'});
})();`;

// Filtros próprios de cada página. Genérico: a barra declara em data-alvo quem ela filtra, os
// controles declaram em data-campo qual atributo do item comparar, e o item guarda os valores em
// data-*. Ordenação usa a propriedade order do flex/grid, sem remexer no DOM.
const SCRIPT_FILTROS_PAGINA = `
(function(){
  document.querySelectorAll('.filtros-pagina').forEach(function(barra){
    var lista=document.querySelector(barra.dataset.alvo);
    if(!lista)return;
    var itens=Array.prototype.slice.call(lista.children);
    var campos=Array.prototype.slice.call(barra.querySelectorAll('[data-campo]'));
    var ordenar=barra.querySelector('[data-ordenar]');
    var contagem=barra.querySelector('[data-contagem]');
    function norm(s){return (s||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');}
    function aplicar(){
      var visiveis=0;
      itens.forEach(function(it){
        var passa=campos.every(function(c){
          var v=c.value;
          if(!v)return true;
          if(c.dataset.campo==='texto')return norm(it.dataset.texto).indexOf(norm(v))>=0;
          return (it.dataset[c.dataset.campo]||'').split(' ').indexOf(v)>=0;
        });
        it.classList.toggle('filtrado',!passa);
        if(passa)visiveis++;
      });
      if(ordenar&&ordenar.value){
        var chave=ordenar.value.replace(/^-/,''),desc=ordenar.value[0]==='-';
        var ord=itens.slice().sort(function(a,b){
          var x=a.dataset['ordem'+chave]||'',y=b.dataset['ordem'+chave]||'';
          var n=Number(x),m=Number(y);
          var r=(!isNaN(n)&&!isNaN(m)&&x!==''&&y!=='')?n-m:String(x).localeCompare(String(y),'pt');
          return desc?-r:r;
        });
        ord.forEach(function(it,i){it.style.order=i;});
      }else itens.forEach(function(it){it.style.order='';});
      if(contagem)contagem.textContent=visiveis===itens.length?'':visiveis+' de '+itens.length;
    }
    campos.forEach(function(c){c.addEventListener(c.tagName==='SELECT'?'change':'input',aplicar);});
    if(ordenar)ordenar.addEventListener('change',aplicar);
    var limpar=barra.querySelector('[data-limpar]');
    if(limpar)limpar.addEventListener('click',function(){
      campos.forEach(function(c){c.value='';});
      if(ordenar)ordenar.selectedIndex=0;
      aplicar();
    });
    document.addEventListener('filtro-divisao',aplicar);
    aplicar();
  });
})();`;

const VISUALIZACOES = [
  ["inicio", "Início", "index.html"],
  ["entenda", "Entenda", "entenda.html"],
  ["trilhas", "Trilhas", "trilhas.html"],
  ["linha-do-tempo", "Linha do tempo", "linha-do-tempo.html"],
  ["casos", "Casos", "casos.html"],
  ["grafo", "Grafo", "grafo.html"],
  ["arvore", "Árvore", "arvore.html"],
];
const SECUNDARIAS = [
  ["quem-e-quem", "Quem é quem", "quem-e-quem.html"],
  ["sobre", "Sobre", "sobre.html"],
  ["correcoes", "Correções", "correcoes.html"],
  ["fontes", "Fontes", "fontes.html"],
];

const pagina = ({ titulo, corpo, profundidade, visualizacao = null, extraHead = "", extraScript = "", migalhas = null, descricao = "", tipo = "website", caminho = "" }) => {
  const raiz = raizDe(profundidade);
  const nav = (lista) => lista.map(([id, nome, arquivo]) =>
    `<a href="${raiz}${arquivo}"${visualizacao === id ? ' aria-current="page"' : ""}>${nome}</a>`).join("");
  const opcoes = Object.entries(DIVISOES).map(([id, d]) => `<option value="${id}">${h(d.nome)}</option>`).join("");
  const base = (projeto.url || "").replace(/\/$/, "");
  const desc = descricao || projeto.descricao || "Base de dados com procedência sobre o caso Banco Master.";
  const urlAbs = `${base}/${caminho}`;
  const dados = [{
    "@context": "https://schema.org",
    "@type": tipo === "article" ? "Article" : "WebPage",
    headline: titulo, name: titulo, description: desc,
    inLanguage: "pt-BR",
    ...(base ? { url: urlAbs, image: `${base}/capa.png` } : {}),
    ...(dataDaBase ? { dateModified: dataDaBase } : {}),
    ...(mantenedorOk ? { author: { "@type": "Person", name: projeto.mantenedor } } : {}),
    isPartOf: { "@type": "WebSite", name: projeto.nome || "Caso Master", ...(base ? { url: base } : {}) },
  }];
  if (migalhas?.length) dados.push({
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: migalhas.map((m, i) => ({
      "@type": "ListItem", position: i + 1, name: m.nome,
      ...(m.href && base ? { item: `${base}/${m.href.replace(/^(\.\/|\.\.\/)+/, "")}` } : {}),
    })),
  });
  const jsonLd = json(dados.length === 1 ? dados[0] : dados);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(titulo)} · Caso Master</title>
<meta name="description" content="${h(desc)}">
${base ? `<link rel="canonical" href="${h(urlAbs)}">` : ""}
<meta property="og:site_name" content="${h(projeto.nome || "Caso Master")}">
<meta property="og:title" content="${h(titulo)} · Caso Master">
<meta property="og:description" content="${h(desc)}">
<meta property="og:type" content="${h(tipo)}">
<meta property="og:locale" content="pt_BR">
${base ? `<meta property="og:url" content="${h(urlAbs)}">
<meta property="og:image" content="${h(base)}/capa.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Ilustração abstrata da rede de entidades do caso Banco Master">` : ""}
<meta name="twitter:card" content="summary_large_image">
<meta name="robots" content="index,follow">
<script type="application/ld+json">${jsonLd}</script>
<script>${SCRIPT_TEMA_CEDO}</script>
<style>${CSS}</style>
<script defer id="indice-busca" src="${raiz}indice-busca.js"></script>
${extraHead}
</head>
<body>
<a class="pular" href="#conteudo">Pular para o conteúdo</a>
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
      <input type="search" name="q" placeholder="Buscar no site" aria-label="Buscar entidades, casos e afirmações" autocomplete="off" data-raiz="${raiz}">
    </form>
    <button type="button" id="tema" aria-label="Alternar tema">◐</button>
  </div>
</header>
${migalhas ? `<nav class="migalhas" aria-label="Você está aqui"><ol>${migalhas.map((m, i) => m.href
  ? `<li><a href="${m.href}">${h(m.nome)}</a></li>`
  : `<li aria-current="page">${h(m.nome)}</li>`).join("")}</ol></nav>` : ""}
<p class="atualizado">Conteúdo atualizado até <time datetime="${h(dataDaBase)}">${h(dataBR(dataDaBase))}</time>${contatoOk ? ` · <a href="${raiz}correcoes.html">como corrigir</a>` : ""}</p>
<section id="resultados-busca" class="resultados" aria-live="polite" hidden></section>
<main id="conteudo" tabindex="-1">
${corpo}
</main>
<footer><p>${h(AVISO)}${mantenedorOk ? ` · mantido por ${creditoMantenedor()}` : ""}</p>
<p><a href="${raiz}index.html">Início</a> · <a href="${raiz}entenda.html">Entenda</a> · <a href="${raiz}trilhas.html">Trilhas</a> · <a href="${raiz}linha-do-tempo.html">Linha do tempo</a> · <a href="${raiz}quem-e-quem.html">Quem é quem</a> · <a href="${raiz}sobre.html">Sobre</a> · <a href="${raiz}fontes.html">Fontes</a> · <a href="${raiz}correcoes.html">Correções</a></p></footer>
<script>${SCRIPT_ESTADO}</script>
<script>${SCRIPT_BUSCA}</script>
<script>${SCRIPT_LINHA}</script>
<script>${SCRIPT_GUIA}</script>
<script>${SCRIPT_FAIXA}</script>
<script>${SCRIPT_FILTROS_PAGINA}</script>
${extraScript}
</body>
</html>
`;
};

// Trilhas de leitura: sequências prontas de casos, para quem não quer decidir por onde entrar.
// ---------- trilhas ----------
// Uma trilha é um percurso guiado, não uma lista. Cada trilha tem página própria e carrega o
// próprio estado para dentro do caso, via ?trilha=<id>&passo=<n>: assim o leitor avança de um caso
// ao seguinte sem voltar à lista. O caso continua sendo a página canônica; a barra é um extra.
const casoPorSlug = new Map(casos.map((c) => [c.slug, c]));
const trilhasResolvidas = trilhas.map((t) => {
  const cs = t.casos.map((slug) => casoPorSlug.get(slug)).filter(Boolean);
  const datas = cs.flatMap((c) => c.afirmacoes.map((id) => afrPorId.get(id)?.data).filter(Boolean)).sort();
  return { ...t, cs, registros: cs.reduce((n, c) => n + c.afirmacoes.length, 0),
           de: datas[0] || "", ate: datas[datas.length - 1] || "" };
});
const linkPasso = (raiz, t, i) => `${raiz}caso/${h(t.cs[i].slug)}.html?trilha=${h(t.id)}&passo=${i + 1}`;

const paginaTrilhas = () => {
  const raiz = raizDe(0);
  return pagina({
    titulo: "Trilhas",
    caminho: "trilhas.html",
    descricao: "Três percursos prontos para entender o caso Banco Master, cada um com uma sequência de casos.",
    profundidade: 0,
    visualizacao: "trilhas",
    migalhas: [{ nome: "Início", href: `${raiz}index.html` }, { nome: "Trilhas" }],
    corpo: `
<h1>Trilhas de leitura <small>${plural(trilhas.length, "trilha", "trilhas")}</small></h1>
<p class="prosa intro-curta">Cada trilha é um percurso guiado: você entra no primeiro caso e avança para o seguinte sem voltar aqui. Se ainda não sabe do que se trata, comece pela <a href="${raiz}index.html">introdução</a>.</p>
<ul class="cartoes-trilha">
${trilhasResolvidas.map((t) => `
  <li class="cartao-trilha">
    <a href="${raiz}trilha/${h(t.id)}.html">
      <h2>${h(t.titulo)}</h2>
      <p class="trilha-resumo">${h(t.resumo)}</p>
      <p class="trilha-meta"><small>${plural(t.cs.length, "caso", "casos")} · ${plural(t.registros, "registro", "registros")}</small></p>
      <ol class="trilha-espia">${t.cs.map((c) => `<li>${h(c.titulo)}</li>`).join("")}</ol>
      <span class="cap-ler">Ver a trilha →</span>
    </a>
  </li>`).join("")}
</ul>`,
  });
};

const paginaTrilha = (t) => {
  const raiz = raizDe(1);
  return pagina({
    titulo: t.titulo,
    caminho: `trilha/${t.id}.html`,
    descricao: t.resumo,
    profundidade: 1,
    visualizacao: "trilhas",
    migalhas: [{ nome: "Início", href: `${raiz}index.html` }, { nome: "Trilhas", href: `${raiz}trilhas.html` }, { nome: t.titulo }],
    corpo: `
<article class="trilha-pagina">
  <p class="trilha-chapeu">Trilha de leitura</p>
  <h1>${h(t.titulo)}</h1>
  <p class="trilha-resumo grande">${h(t.resumo)}</p>
  <p class="trilha-meta"><small>${plural(t.cs.length, "caso", "casos")} · ${plural(t.registros, "registro", "registros")}${t.de ? ` · de ${h(dataBR(t.de))} a ${h(dataBR(t.ate))}` : ""}</small></p>
  ${t.cs.length ? `<p class="trilha-comecar"><a class="botao grande" href="${linkPasso(raiz, t, 0)}">Começar a trilha →</a></p>` : ""}
  <h2 class="trilha-sub">Os ${plural(t.cs.length, "passo", "passos")}</h2>
  <ol class="trilha-passos">
${t.cs.map((c, i) => `
    <li>
      <span class="passo-n" aria-hidden="true">${i + 1}</span>
      <div class="passo-corpo">
        <h3><a href="${linkPasso(raiz, t, i)}">${h(c.titulo)}</a></h3>
        <p class="passo-resumo">${h((c.resumo.match(/^.*?[.!?](?=\s|$)/) || [c.resumo])[0])}</p>
        <p class="passo-meta">${rotuloDivisao(c.divisao_principal)} <small>· ${plural(c.afirmacoes.length, "registro", "registros")}</small></p>
      </div>
    </li>`).join("")}
  </ol>
  <p class="ler-tudo"><a href="${raiz}trilhas.html">Ver as outras trilhas →</a></p>
</article>`,
  });
};



// Miniaturas do grafo e da árvore para a chamada na página inicial: SVG estático, derivado dos
// mesmos dados, sem biblioteca e sem imagem de terceiro (política de imagens do projeto).
const miniGrafo = () => {
  const top = [...grafo.nodes].sort((a, b) => b.grau - a.grau).slice(0, 9);
  const centro = top[0], volta = top.slice(1);
  const W = 300, H = 180, cx = W / 2, cy = H / 2, rx = 118, ry = 66;
  const pos = new Map([[centro.id, { x: cx, y: cy, r: 11 }]]);
  volta.forEach((n, i) => {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / volta.length;
    pos.set(n.id, { x: cx + rx * Math.cos(ang), y: cy + ry * Math.sin(ang), r: 4 + Math.sqrt(n.grau) * 1.1 });
  });
  const dentro = new Set(top.map((n) => n.id));
  const linhas = grafo.links.filter((l) => dentro.has(l.source) && dentro.has(l.target)).map((l) => {
    const a = pos.get(l.source), b = pos.get(l.target);
    return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke-width="${Math.min(2, 0.4 + l.peso * 0.18).toFixed(2)}"/>`;
  }).join("");
  const bolas = top.map((n) => {
    const p = pos.get(n.id);
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.r.toFixed(1)}" fill="var(--${h(n.grupo)})"/>`;
  }).join("");
  return `<svg class="mini" viewBox="0 0 ${W} ${H}" role="img" aria-label="Prévia do grafo: ${top.length} entidades e suas ligações" focusable="false">
    <g class="mini-arestas">${linhas}</g>${bolas}</svg>`;
};

const miniArvore = () => {
  const W = 300, H = 180, x0 = 30, COL = 38, TOPO = 18, BASE = H - 16;
  const ramos = casosCronologicos.slice(0, 6);
  const partes = ramos.map((c, i) => {
    const x = x0 + i * COL, y0 = TOPO + i * 15;
    const cor = `var(--${h(c.divisao_principal)})`;
    const pai = i === 0 ? null : x0 + (i - 1) * COL, py = y0 - 15;
    const pontos = [26, 52, 78].map((d) => y0 + d).filter((y) => y < BASE - 6)
      .map((y, k) => `<circle cx="${x}" cy="${y}" r="3" fill="${cor}" opacity="${k ? .5 : .85}"/>`).join("");
    return `${pai !== null ? `<path d="M${pai},${py} C${pai},${py + 8} ${x},${py + 4} ${x},${y0}" fill="none" stroke="${cor}" stroke-width="2"/>` : ""}
      <line x1="${x}" y1="${y0}" x2="${x}" y2="${BASE}" stroke="${cor}" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="${x}" cy="${y0}" r="4.5" fill="var(--fundo)" stroke="${cor}" stroke-width="2"/>${pontos}`;
  }).join("");
  return `<svg class="mini" viewBox="0 0 ${W} ${H}" role="img" aria-label="Prévia da árvore: casos que se ramificam no tempo" focusable="false">${partes}</svg>`;
};

// ---------- imagem de compartilhamento ----------
// og:image precisa ser raster: WhatsApp e X não renderizam SVG. Geramos um PNG à mão com o zlib
// do Node, sem dependência e sem imagem de terceiro. Ilustração abstrata da rede, sem fotos.
const gerarCapa = (destino) => {
  const W = 1200, H = 630;
  const px = Buffer.alloc(W * H * 3);
  const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  const FUNDO = rgb("#151514");
  for (let i = 0; i < W * H; i++) { px[i * 3] = FUNDO[0]; px[i * 3 + 1] = FUNDO[1]; px[i * 3 + 2] = FUNDO[2]; }
  const ponto = (x, y, c, a = 1) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    for (let k = 0; k < 3; k++) px[i + k] = Math.round(px[i + k] * (1 - a) + c[k] * a);
  };
  const linha = (x1, y1, x2, y2, c, a) => {
    const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
    for (let i = 0; i <= n; i++) ponto(x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n, c, a);
  };
  const disco = (cx, cy, r, c) => {
    for (let y = -r - 1; y <= r + 1; y++) for (let x = -r - 1; x <= r + 1; x++) {
      const d = Math.hypot(x, y);
      if (d <= r + 1) ponto(cx + x, cy + y, c, Math.min(1, Math.max(0, r + 0.5 - d)));
    }
  };
  // Rede derivada dos dados: as entidades mais conectadas, dispostas em duas elipses.
  const top = [...grafo.nodes].sort((a, b) => b.grau - a.grau).slice(0, 16);
  const cores = Object.fromEntries(Object.entries(DIVISOES).map(([k, v]) => [k, rgb(v.cor)]));
  const pos = new Map();
  top.forEach((n, i) => {
    const anel = i < 6 ? 0 : 1, dentro = anel === 0 ? 6 : top.length - 6, j = anel === 0 ? i : i - 6;
    const ang = (2 * Math.PI * j) / dentro + (anel ? 0.4 : 0);
    const rx = anel ? 470 : 210, ry = anel ? 250 : 112;
    pos.set(n.id, { x: W / 2 + rx * Math.cos(ang), y: H / 2 + ry * Math.sin(ang), r: anel ? 9 : 15 });
  });
  const dentro = new Set(top.map((n) => n.id));
  for (const l of grafo.links) {
    if (!dentro.has(l.source) || !dentro.has(l.target)) continue;
    const a = pos.get(l.source), b = pos.get(l.target);
    linha(a.x, a.y, b.x, b.y, [130, 125, 118], Math.min(0.5, 0.12 + l.peso * 0.05));
  }
  for (const n of top) { const p = pos.get(n.id); disco(p.x, p.y, p.r, cores[n.grupo] || [150, 150, 150]); }
  // faixa inferior, para o texto do card não competir com a ilustração
  for (let y = H - 96; y < H; y++) for (let x = 0; x < W; x++) ponto(x, y, FUNDO, Math.min(1, (y - (H - 96)) / 60));

  const cru = Buffer.alloc(H * (W * 3 + 1));
  for (let y = 0; y < H; y++) { cru[y * (W * 3 + 1)] = 0; px.copy(cru, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
  const tabelaCrc = Array.from({ length: 256 }, (_, n) => {
    let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
  });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = tabelaCrc[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const bloco = (tipo, dados) => {
    const t = Buffer.from(tipo, "ascii"), tam = Buffer.alloc(4), fim = Buffer.alloc(4);
    tam.writeUInt32BE(dados.length); fim.writeUInt32BE(crc(Buffer.concat([t, dados])));
    return Buffer.concat([tam, t, dados, fim]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(destino, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    bloco("IHDR", ihdr),
    bloco("IDAT", deflateSync(cru, { level: 9 })),
    bloco("IEND", Buffer.alloc(0)),
  ]));
};

// ---------- guia de entrada ----------
// Sobreposição que aparece ao abrir a página inicial e some no X, revelando a introdução atrás.
// Sem localStorage (regra do projeto): quem fecha carrega guia=0 na URL, como tema e divisão, então
// a navegação interna não repete o guia. Uma visita nova mostra de novo.
const cartoesDoGuia = (raiz) => [
  {
    titulo: "O que é este site",
    corpo: `<p>Uma base de dados sobre o caso do <strong>Banco Master</strong>. Cada informação traz <strong>quem disse, quando e com que fonte</strong>.</p>
            <p>O site não diz quem é culpado. Mostra o registro e deixa a conclusão com você.</p>`,
  },
  {
    titulo: "Ninguém foi condenado",
    corpo: `<p><strong>Nenhuma pessoa citada aqui foi condenada criminalmente até agora.</strong> Por isso cada registro diz o que ele é, e traz a resposta de quem foi citado sempre que existe.</p>
            <ul class="tipos">
              <li>${rotuloNatureza("fato")} <span>aconteceu e pode ser verificado</span></li>
              <li>${rotuloNatureza("decisao")} <span>ato formal de um órgão</span></li>
              <li>${rotuloNatureza("alegacao")} <span>alguém afirma, ainda não está provado</span></li>
              <li>${rotuloNatureza("desmentido")} <span>foi negado, e continua registrado</span></li>
            </ul>`,
  },
  {
    titulo: "De onde vem cada informação",
    corpo: `<p>Toda afirmação aponta para ao menos uma fonte com link. O <strong>nível</strong> diz o quanto ela é próxima do documento original: 1 é o próprio órgão, 4 é só ponto de partida.</p>
            <p>A marca <span class="selo nao-conferida">não conferida</span> avisa que o registro ainda não passou por revisão humana.</p>`,
  },
  {
    titulo: "Quatro formas de ver",
    corpo: `<ul class="formas">
              <li><a href="${raiz}linha-do-tempo.html">Linha do tempo</a> <span>tudo em ordem de data</span></li>
              <li><a href="${raiz}casos.html">Casos</a> <span>os episódios, um por vez</span></li>
              <li><a href="${raiz}grafo.html">Grafo</a> <span>quem se liga a quem</span></li>
              <li><a href="${raiz}arvore.html">Árvore</a> <span>de onde partiu e como se dividiu</span></li>
            </ul>`,
  },
  {
    titulo: "Por onde começar",
    corpo: `<p>Feche este guia e leia a <strong>introdução</strong>, em nove capítulos curtos.</p>
            <p>Com pouco tempo, siga uma <a href="${raiz}trilhas.html">trilha de leitura</a>: três percursos prontos, de quatro ou cinco casos cada.</p>
            <p>Se já conhece o caso, vá direto à <a href="${raiz}linha-do-tempo.html">linha do tempo</a> e use os filtros.</p>`,
  },
];

const renderGuia = (raiz) => {
  const cartoes = cartoesDoGuia(raiz);
  return `
<dialog class="guia" id="guia" aria-labelledby="guia-titulo">
  <button type="button" class="guia-fechar" id="guia-fechar" aria-label="Fechar o guia">×</button>
  <p class="guia-chapeu" id="guia-titulo">Primeira vez aqui?</p>
  <div class="guia-trilho" tabindex="0" role="group" aria-label="Guia do site">
    ${cartoes.map((c, i) => `
    <article class="guia-cartao" data-i="${i}">
      <p class="guia-passo">${i + 1} de ${cartoes.length}</p>
      <h3>${h(c.titulo)}</h3>
      ${c.corpo}
    </article>`).join("")}
  </div>
  <div class="guia-rodape">
    <div class="guia-pontos" role="tablist" aria-label="Ir para o cartão">
      ${cartoes.map((c, i) => `<button type="button" role="tab" data-i="${i}" aria-label="Cartão ${i + 1}: ${h(c.titulo)}"></button>`).join("")}
    </div>
    <div class="guia-nav">
      <button type="button" data-dir="-1" aria-label="Cartão anterior">←</button>
      <button type="button" data-dir="1" aria-label="Próximo cartão">→</button>
      <button type="button" class="guia-pular" id="guia-pular">Pular</button>
    </div>
  </div>
</dialog>`;
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

// Página inicial: painel escaneável. A narrativa longa mora em entenda.html; aqui ficam os
// números, o resumo em três pontos, as trilhas, a legenda das marcas e os capítulos em cards.
const paginaInicial = () => {
  const raiz = raizDe(0);
  const afrConferidas = afirmacoes.filter(conferida).length;
  const metricas = [
    { valor: afirmacoes.length, rotulo: "afirmações",
      nota: afrConferidas ? `${afrConferidas} conferidas por revisão humana` : "base em construção: a revisão humana está em curso",
      href: `${raiz}linha-do-tempo.html` },
    { valor: casos.length, rotulo: "casos", nota: "episódios agrupados", href: `${raiz}casos.html` },
    { valor: entidades.length, rotulo: "entidades", nota: "pessoas e organizações", href: `${raiz}quem-e-quem.html` },
    { valor: fontes.length, rotulo: "fontes", nota: "todas com link", href: `${raiz}fontes.html` },
  ];
  const porSlug = new Map(casos.map((c) => [c.slug, c]));

  const painel = `
<section class="painel" aria-labelledby="painel-titulo">
  <h2 class="oculto" id="painel-titulo">A base em números</h2>
  <div class="metricas">
${metricas.map((m) => `
    <a class="metrica" href="${m.href}">
      <span class="metrica-valor">${m.valor}</span>
      <span class="metrica-rotulo">${h(m.rotulo)}</span>
      <span class="metrica-nota">${h(m.nota)}</span>
    </a>`).join("")}
  </div>
</section>`;

  const resumo = resumoRapido.length ? `
<section class="resumo-rapido" aria-labelledby="resumo-titulo">
  <h2 id="resumo-titulo">Em resumo</h2>
  <ul class="pontos">
${resumoRapido.map((it) => `
    <li>
      <h3>${h(it.rotulo)}</h3>
      <p>${inline(it.texto, raiz)}</p>
    </li>`).join("")}
  </ul>
</section>` : "";

  const destaqueTrilhas = trilhas.length ? `
<section class="destaque-trilhas" aria-labelledby="trilhas-titulo">
  <div class="destaque-texto">
    <h2 id="trilhas-titulo">Não sabe por onde começar?</h2>
    <p>Siga um percurso pronto. Cada trilha é uma sequência de casos na ordem que faz sentido.</p>
    <a class="secao-link" href="${raiz}trilhas.html">Ver todas as trilhas →</a>
  </div>
  <div class="trilhas-cta">
${trilhas.map((t) => {
    const cs = t.casos.map((slug) => porSlug.get(slug)).filter(Boolean);
    const registros = cs.reduce((n, c) => n + c.afirmacoes.length, 0);
    return `
    <a class="cta" href="${raiz}trilha/${h(t.id)}.html">
      <span class="cta-titulo">${h(t.titulo)}</span>
      <span class="cta-nota">${h(t.resumo)}</span>
      <span class="cta-meta">${plural(cs.length, "caso", "casos")} · ${plural(registros, "registro", "registros")}</span>
    </a>`;
  }).join("")}
  </div>
</section>` : "";

  const taxonomia = `
<section class="taxonomia" aria-labelledby="taxonomia-titulo">
  <div class="taxonomia-texto">
    <h2 id="taxonomia-titulo">Como ler cada registro <small>ninguém citado foi condenado; por isso cada informação é marcada pelo que ela é</small></h2>
  </div>
  <dl class="marcas compacta">
    <div><dt>${rotuloNatureza("fato")}</dt><dd>aconteceu e pode ser verificado</dd></div>
    <div><dt>${rotuloNatureza("decisao")}</dt><dd>ato formal de um órgão</dd></div>
    <div><dt>${rotuloNatureza("alegacao")}</dt><dd>alguém afirma, ainda não provado; vem com quem afirmou e a resposta do citado</dd></div>
    <div><dt>${rotuloNatureza("desmentido")}</dt><dd>foi negado, e continua registrado</dd></div>
    <div><dt><span class="selo nao-conferida">não conferida</span></dt><dd>ainda sem revisão humana</dd></div>
  </dl>
</section>`;

  const capitulos = `
<section class="capitulos-grade" aria-labelledby="capitulos-titulo">
  <div class="secao-cabecalho">
    <h2 id="capitulos-titulo">O caso em ${plural(introducao.capitulos.length, "capítulo", "capítulos")}</h2>
    <a class="secao-link" href="${raiz}entenda.html">Ver todos os capítulos →</a>
  </div>
  <ol class="grade-capitulos">
${introducao.capitulos.map((c, i) => `
    <li class="cap-card">
      <a href="${raiz}${c.arquivo}">
        <span class="cap-n">${String(i + 1).padStart(2, "0")}</span>
        <h3>${h(c.titulo.replace(/^\d+\.\s*/, ""))}</h3>
        <p>${h(resumoCurto(c.texto, 118))}</p>
        <span class="cap-ler">Ler capítulo →</span>
      </a>
    </li>`).join("")}
  </ol>
</section>`;

  const explorar = `
<section class="explorar" aria-labelledby="explorar-titulo">
  <h2 id="explorar-titulo">Explore a rede do caso</h2>
  <div class="explorar-cartoes">
    <a class="explorar-cartao" href="${raiz}grafo.html">
      <div class="mini-caixa">${miniGrafo()}</div>
      <h3>Grafo</h3>
      <p>Quem aparece com quem. Cada linha é uma afirmação que cita as duas partes, e a espessura mostra quantas são. Clique num nó para acender só as ligações dele.</p>
      <span class="cap-ler">Abrir o grafo →</span>
    </a>
    <a class="explorar-cartao" href="${raiz}arvore.html">
      <div class="mini-caixa">${miniArvore()}</div>
      <h3>Árvore</h3>
      <p>De onde o caso partiu e em que assuntos se dividiu. O tempo corre de cima para baixo e cada coluna é um caso que nasce de outro.</p>
      <span class="cap-ler">Abrir a árvore →</span>
    </a>
  </div>
</section>`;

  return pagina({
    titulo: "Início",
    caminho: "",
    descricao: "Base de dados com procedência sobre o caso Banco Master: o que foi dito, por quem, quando e com que fonte.",
    profundidade: 0,
    visualizacao: "inicio",
    corpo: `
<section class="abertura">
  <h1 class="lede">${primeiroParagrafo}</h1>
  <p class="lede-link"><a href="${raiz}sobre.html">Sobre o projeto →</a></p>
</section>
${resumo}
${painel}
${destaqueTrilhas}
${taxonomia}
${capitulos}
${explorar}
${renderGuia(raiz)}`,
  });
};

// ---------- Entenda: eixo, leitura focada e versão contínua ----------
// A narrativa longa deixa de ser uma página só. Cada capítulo vira uma página real, com endereço
// próprio: link direto funciona sem script, a busca continua indexando o texto e o leitor lê um
// capítulo por vez. O eixo (entenda.html) traz o resumo e a faixa de capítulos.

const seloAndamento = (c) => c.emAndamento ? `<span class="selo-andamento">Em andamento</span>` : "";
const tempoLeitura = (c) => `<span class="cap-tempo">${c.minutos} min de leitura</span>`;

const faixaCapitulos = (raiz, atual = null) => `
<section class="faixa" aria-labelledby="faixa-titulo">
  <div class="faixa-cabecalho">
    <h2 id="faixa-titulo">Os ${introducao.capitulos.length} capítulos</h2>
    <div class="faixa-controles">
      <p class="faixa-posicao" aria-live="polite" id="faixa-posicao"></p>
      <button type="button" class="faixa-seta" data-dir="-1" aria-label="Capítulos anteriores">←</button>
      <button type="button" class="faixa-seta" data-dir="1" aria-label="Próximos capítulos">→</button>
    </div>
  </div>
  <ol class="faixa-trilho" id="faixa-trilho" tabindex="0" aria-label="Capítulos, use as setas do teclado para percorrer">
${introducao.capitulos.map((c) => `
    <li class="faixa-cartao${atual === c.id ? " atual" : ""}"${atual === c.id ? ' aria-current="true"' : ""}>
      <a href="${raiz}${c.arquivo}">
        <span class="cap-topo"><span class="cap-n">${String(c.numero).padStart(2, "0")}</span>${seloAndamento(c)}</span>
        <span class="cap-titulo">${h(c.tituloCurto)}</span>
        <span class="cap-resumo">${h(resumoCurto(c.texto, 120))}</span>
        <span class="cap-rodape">${tempoLeitura(c)}<span class="cap-ler">Ler →</span></span>
      </a>
    </li>`).join("")}
  </ol>
</section>`;

const paginaEntenda = () => {
  const raiz = raizDe(0);
  return pagina({
    titulo: "Entenda o caso",
    profundidade: 0,
    visualizacao: "entenda",
    caminho: "entenda.html",
    descricao: "O caso Banco Master em nove capítulos, do crescimento do banco à crise no STF.",
    migalhas: [{ nome: "Início", href: `${raiz}index.html` }, { nome: "Entenda" }],
    corpo: `
<h1>${h(introducao.tituloPrincipal || "Entenda o caso")}</h1>
<div class="prosa entenda-resumo">${introducao.preambulo}</div>
${faixaCapitulos(raiz)}
<p class="ler-tudo"><a href="${raiz}entenda-completo.html">Ler todos os capítulos de uma vez →</a></p>`,
  });
};

const paginaCapitulo = (c, i) => {
  const raiz = raizDe(1);
  const fundo = introducaoFunda.capitulos[i] || c;
  const anterior = introducao.capitulos[i - 1], proximo = introducao.capitulos[i + 1];
  const indice = introducao.capitulos.map((x) => `
    <li${x.id === c.id ? ' aria-current="true"' : ""}><a href="${raiz}${x.arquivo}"><span>${String(x.numero).padStart(2, "0")}</span> ${h(x.tituloCurto)}</a></li>`).join("");
  return pagina({
    titulo: c.tituloCurto,
    profundidade: 1,
    visualizacao: "entenda",
    tipo: "article",
    caminho: c.arquivo,
    descricao: resumoCurto(c.texto, 200),
    migalhas: [{ nome: "Início", href: `${raiz}index.html` }, { nome: "Entenda", href: `${raiz}entenda.html` }, { nome: c.tituloCurto }],
    corpo: `
<article class="capitulo duas-colunas">
  <div class="prosa capitulo-texto">
    <p class="capitulo-progresso">
      <span class="progresso-texto">Capítulo ${c.numero} de ${introducao.capitulos.length}</span>
      ${seloAndamento(c)} ${tempoLeitura(c)}
      <span class="progresso-barra" role="img" aria-label="Capítulo ${c.numero} de ${introducao.capitulos.length}"><i style="width:${Math.round((c.numero / introducao.capitulos.length) * 100)}%"></i></span>
    </p>
    <h1 id="${h(c.id)}">${h(c.tituloCurto)}</h1>
    ${fundo.periodo ? `<p class="capitulo-periodo">${fundo.periodo}</p>` : ""}
    ${fundo.html}
    <nav class="capitulo-nav" aria-label="Navegação entre capítulos">
      ${anterior ? `<a class="nav-anterior" href="${raiz}${anterior.arquivo}"><small>← Capítulo anterior</small>${h(anterior.tituloCurto)}</a>` : `<span></span>`}
      <a class="nav-todos" href="${raiz}entenda.html">Ver todos os capítulos</a>
      ${proximo ? `<a class="nav-proximo" href="${raiz}${proximo.arquivo}"><small>Próximo capítulo →</small>${h(proximo.tituloCurto)}</a>` : `<span></span>`}
    </nav>
    <p class="ler-tudo"><a href="${raiz}entenda-completo.html">Ler todos os capítulos de uma vez →</a></p>
  </div>
  <aside class="lateral">
    <nav class="capitulos indice-capitulos" aria-label="Capítulos">
      <h2>Capítulos</h2>
      <ol>${indice}</ol>
    </nav>
  </aside>
</article>`,
  });
};

const paginaEntendaCompleto = () => {
  const raiz = raizDe(0);
  const indice = introducao.capitulos.map((c) => `<li><a href="#${h(c.id)}">${h(c.titulo)}</a></li>`).join("");
  const corpoCapitulos = introducao.capitulos.map((c) => `
  <section class="cap-longo" id="${h(c.id)}" aria-labelledby="t-${h(c.id)}">
    <p class="cap-longo-meta"><span class="cap-n">${String(c.numero).padStart(2, "0")} de ${introducao.capitulos.length}</span>${seloAndamento(c)}${tempoLeitura(c)}</p>
    <h2 id="t-${h(c.id)}">${h(c.tituloCurto)}</h2>
    ${c.periodo ? `<p class="capitulo-periodo">${c.periodo}</p>` : ""}
    ${c.html}
    <p class="cap-longo-link"><a href="${raiz}${c.arquivo}">Abrir só este capítulo →</a></p>
  </section>`).join("");
  return pagina({
    titulo: "Todos os capítulos",
    profundidade: 0,
    visualizacao: "entenda",
    caminho: "entenda-completo.html",
    descricao: "A narrativa completa do caso Banco Master, os nove capítulos em sequência.",
    migalhas: [{ nome: "Início", href: `${raiz}index.html` }, { nome: "Entenda", href: `${raiz}entenda.html` }, { nome: "Todos os capítulos" }],
    corpo: `
<section class="introducao">
  <div class="intro-texto prosa">
    <h1>${h(introducao.tituloPrincipal || "O caso em capítulos")}</h1>
    ${introducao.preambulo}
    ${corpoCapitulos}
    <p class="depois"><a class="botao" href="${raiz}trilhas.html">Trilhas de leitura →</a> <a class="botao" href="${raiz}linha-do-tempo.html">Explorar a linha do tempo →</a> <a class="botao" href="${raiz}quem-e-quem.html">Quem é quem →</a></p>
  </div>
  <aside class="intro-lateral">
    <nav class="capitulos" aria-label="Capítulos"><h2>Capítulos</h2><ol>${indice}</ol><p class="ir-caminhos"><a href="${raiz}entenda.html">Ler um capítulo por vez →</a></p></nav>
  </aside>
</section>`,
  });
};

const paginaLinhaDoTempo = () => {
  const raiz = raizDe(0);
  const cronologia = [...afirmacoes].sort(porData);
  return pagina({
    titulo: "Linha do tempo",
    caminho: "linha-do-tempo.html",
    descricao: "Todos os registros do caso Banco Master em ordem cronológica, com filtros.",
    profundidade: 0,
    visualizacao: "linha-do-tempo",
    corpo: `
${avisoInline()}
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
    caminho: "quem-e-quem.html",
    descricao: "As pessoas e organizações do caso Banco Master, por divisão.",
    profundidade: 0,
    visualizacao: "quem-e-quem",
    corpo: `
<h1>Quem é quem <small>${entidades.length} pessoas e organizações, por divisão</small></h1>
<p class="prosa intro-curta">Cada entidade traz só o que ela é. Nenhuma acusação vive aqui: o que se afirma sobre cada uma está nas afirmações, com fonte e resposta.</p>
<form class="filtros-pagina" data-alvo=".lista-entidades" onsubmit="return false" aria-label="Filtrar entidades">
  <label>Buscar <input type="search" data-campo="texto" placeholder="nome" autocomplete="off"></label>
  <label>Tipo <select data-campo="tipo"><option value="">Todos</option><option value="pessoa">Pessoas</option><option value="organizacao">Organizações</option></select></label>
  <label>Divisão <select data-campo="divisao"><option value="">Todas</option>${Object.entries(DIVISOES).map(([id, d]) => `<option value="${id}">${h(d.nome)}</option>`).join("")}</select></label>
  <label>Ordenar <select data-ordenar>
    <option value="-registros">mais registros</option>
    <option value="nome">nome A-Z</option>
  </select></label>
  <button type="button" data-limpar>Limpar</button>
  <small data-contagem></small>
</form>
<ul class="lista-entidades">
${entidades.map((e) => `
  <li class="cartao-entidade" data-divisoes="${h(e.grupo)}" data-divisao="${h(e.grupo)}" data-tipo="${h(e.tipo)}"
      data-texto="${h(e.nome + " " + (e.descricao || ""))}" data-ordem-registros="${contagem.get(e.id)}" data-ordem-nome="${h(e.nome)}"
      style="--cor:var(--${h(e.grupo)})">
    <a href="${raiz}entidade/${h(e.id)}.html">
      <span class="ent-topo">${rotuloDivisao(e.grupo)}<small>${plural(contagem.get(e.id), "registro", "registros")}</small></span>
      <h3>${h(e.nome)}</h3>
      ${e.descricao ? `<p>${h(resumoCurto(e.descricao, 120))}</p>` : ""}
    </a>
  </li>`).join("")}
</ul>`,
  });
};

const paginaSobre = () => {
  const raiz = raizDe(0);
  return pagina({
    titulo: "Sobre",
    profundidade: 0,
    visualizacao: "sobre",
    caminho: "sobre.html",
    descricao: "Por que este site existe, como ele registra cada informação e como conferir ou corrigir.",
    migalhas: [{ nome: "Início", href: `${raiz}index.html` }, { nome: "Sobre" }],
    corpo: `
<h1>Sobre o projeto</h1>
<section class="sobre prosa">${sobreHtml}
${mantenedorOk ? `<p class="ficha-mantenedor">Mantido por ${creditoMantenedor()}${contatoOk ? `. Contato para correções e direito de resposta: <a href="mailto:${h(projeto.contato)}">${h(projeto.contato)}</a>` : ""}.</p>` : ""}
</section>
<p class="depois"><a class="botao" href="${raiz}fontes.html">Ver todas as fontes →</a> <a class="botao" href="${raiz}correcoes.html">Correções →</a></p>`,
  });
};

// ---------- fontes: todas, por nível, com uso ----------
const paginaFontes = () => {
  const dominioDe = (url) => { try { return new URL(url).hostname.replace(/^www\d*\./, ""); } catch { return ""; } };
  const grupos = `
<ul class="lista-fontes todas-fontes">
${[...fontes].sort((a, b) => a.nivel - b.nivel || (a.veiculo || "").localeCompare(b.veiculo || "")).map((f) => `
  <li data-nivel="${f.nivel}" data-texto="${h([f.titulo, f.veiculo, dominioDe(f.url)].filter(Boolean).join(" "))}"
      data-ordem-nivel="${f.nivel}" data-ordem-usos="${usoDaFonte.get(f.id) || 0}"
      data-ordem-data="${h(f.data || "")}" data-ordem-veiculo="${h(f.veiculo || "")}">
    <div>
      <a href="${h(f.url)}" target="_blank" rel="noopener">${h(f.titulo || f.url)}</a>
      <small><span class="nivel-selo nivel-${f.nivel}">nível ${f.nivel}</span> ${h(f.veiculo || "")}${f.data ? " · " + dataBR(f.data) : " · sem data"}${f.nota ? " · " + h(f.nota) : ""}</small>
    </div>
    <span class="uso">${plural(usoDaFonte.get(f.id) || 0, "uso", "usos")}</span>
  </li>`).join("")}
</ul>`;
  const dominios = Object.entries(permitidas.dominios || {}).sort((a, b) => a[1].nivel - b[1].nivel || a[0].localeCompare(b[0]));
  return pagina({
    titulo: "Fontes",
    caminho: "fontes.html",
    descricao: "Todas as fontes usadas no site, por nível, com link e contagem de usos.",
    profundidade: 0,
    visualizacao: "fontes",
    corpo: `
<h1>Fontes <small>${fontes.length} registradas · ${afirmacoes.length} afirmações</small></h1>
<form class="filtros-pagina" data-alvo=".todas-fontes" onsubmit="return false" aria-label="Filtrar fontes">
  <label>Buscar <input type="search" data-campo="texto" placeholder="título, veículo ou domínio" autocomplete="off"></label>
  <label>Nível <select data-campo="nivel"><option value="">Todos</option>${[1, 2, 3, 4].map((n) => `<option value="${n}">Nível ${n}</option>`).join("")}</select></label>
  <label>Ordenar <select data-ordenar>
    <option value="nivel">nível</option>
    <option value="-usos">mais usadas</option>
    <option value="-data">mais recentes</option>
    <option value="veiculo">veículo A-Z</option>
  </select></label>
  <button type="button" data-limpar>Limpar</button>
  <small data-contagem></small>
</form>
<p class="prosa">Toda afirmação do site aponta para ao menos uma fonte com link. O nível diz de onde a informação vem: quanto menor, mais perto do documento original. Fontes de nível 4 nunca sustentam nada sozinhas.</p>
<ul class="legenda-niveis">${[1, 2, 3, 4].map((n) => `<li><span class="nivel-selo nivel-${n}">nível ${n}</span> ${h(NIVEIS[n])}</li>`).join("")}</ul>
${grupos}
<h2>Domínios aceitos <small>${dominios.length}</small></h2>
<p class="prosa"><small>${h(permitidas.criterio || "")}</small></p>
<ul class="lista-fontes">
${dominios.map(([dom, d]) => `<li><div>${h(dom)} <small>${h(d.nota || "")}</small></div><span class="uso">nível ${d.nivel}</span></li>`).join("")}
</ul>`,
  });
};

const paginaCorrecoes = () => {
  const raiz = raizDe(0);
  const naoConferidas = afirmacoes.filter((a) => !conferida(a)).length;
  return pagina({
    titulo: "Correções",
    profundidade: 0,
    visualizacao: "correcoes",
    caminho: "correcoes.html",
    descricao: "Registro público das correções feitas no site: o que mudou, quando e por quê.",
    migalhas: [{ nome: "Início", href: `${raiz}index.html` }, { nome: "Correções" }],
    extraScript: contatoOk ? `<script>window.REGISTROS=${json(Object.fromEntries(afirmacoes.map((a) => {
      const caso = (casosDaAfirmacao.get(a.id) || [])[0];
      return [a.id, { t: resumoCurto(a.texto, 140), u: caso ? `caso/${caso.slug}.html#${a.id}` : `linha-do-tempo.html#${a.id}` }];
    })))};window.CONTATO=${json(projeto.contato)};window.SITE=${json((projeto.url || "").replace(/\/$/, ""))};</script>
<script>${SCRIPT_PEDIDO}</script>` : "",
    corpo: `
<h1>Correções <small>${plural(correcoes.length, "registro alterado", "registros alterados")}</small></h1>
<section id="pedido-correcao" class="pedido-correcao" hidden></section>
<div class="prosa">
  <p>Neste site, uma correção nunca é silenciosa. Quando um registro muda, a mudança fica anotada no histórico dele e aparece aqui, com data e motivo. Afirmações desmentidas ou arquivadas também não são apagadas: mudam de natureza e permanecem visíveis.</p>
  <p>Estado atual da revisão: <strong>${afirmacoes.length - naoConferidas} de ${afirmacoes.length}</strong> afirmações conferidas contra a fonte original por um humano. As demais trazem a marca <span class="selo nao-conferida">não conferida</span>.</p>
  ${contatoOk
    ? `<p>Achou um erro? Escreva para <a href="mailto:${h(projeto.contato)}?subject=${encodeURIComponent("Correção no site")}">${h(projeto.contato)}</a>, de preferência com o identificador do registro e o link da fonte que sustenta a correção. Cada registro tem um botão “Reportar erro” que já preenche esses campos.</p>`
    : `<p class="vazio">Defina um endereço de contato em dados/projeto.json para receber pedidos de correção.</p>`}
</div>
${correcoes.length ? `
<h2>Histórico</h2>
<ol class="lista-correcoes">
${correcoes.map((c) => {
  const caso = (casosDaAfirmacao.get(c.afirmacao.id) || [])[0];
  const url = caso ? `${raiz}caso/${h(caso.slug)}.html#${h(c.afirmacao.id)}` : `${raiz}linha-do-tempo.html#${h(c.afirmacao.id)}`;
  return `
  <li>
    <p class="correcao-cabecalho"><time datetime="${h(c.data || "")}">${h(dataBR(c.data))}</time> ${c.por ? `<small>por ${h(c.por)}</small>` : ""}</p>
    <p class="correcao-texto">${h(c.mudanca || "")}</p>
    <p class="correcao-alvo"><a href="${url}">${h(resumoCurto(c.afirmacao.texto, 110))}</a></p>
  </li>`;
}).join("")}
</ol>` : `<p class="vazio">Nenhuma correção registrada até agora.</p>`}`,
  });
};

// ---------- casos (cards) ----------
const paginaCasos = () => {
  const raiz = raizDe(0);
  const cards = [...casos].sort((a, b) => (b.atualizado_em || "").localeCompare(a.atualizado_em || ""));
  return pagina({
    titulo: "Casos",
    caminho: "casos.html",
    descricao: "Os episódios do caso Banco Master, um a um.",
    profundidade: 0,
    visualizacao: "casos",
    corpo: `
<h1>Casos <small>${casos.length}</small></h1>
<form class="filtros-pagina" data-alvo=".cards" onsubmit="return false" aria-label="Filtrar casos">
  <label>Buscar <input type="search" data-campo="texto" placeholder="título ou resumo" autocomplete="off"></label>
  <label>Divisão <select data-campo="divisao"><option value="">Todas</option>${Object.entries(DIVISOES).map(([id, d]) => `<option value="${id}">${h(d.nome)}</option>`).join("")}</select></label>
  <label>Ordenar <select data-ordenar>
    <option value="cronologia">mais antigo primeiro</option>
    <option value="-cronologia">mais recente primeiro</option>
    <option value="-registros">mais registros</option>
    <option value="titulo">título A-Z</option>
  </select></label>
  <button type="button" data-limpar>Limpar</button>
  <small data-contagem></small>
</form>
<ul class="cards">
${cards.map((c) => `
  <li class="card" data-divisoes="${h(c.divisao_principal)}" data-divisao="${h(c.divisao_principal)}"
      data-texto="${h(c.titulo + " " + c.resumo)}" data-ordem-cronologia="${h(dataDoCaso(c))}"
      data-ordem-registros="${c.afirmacoes.length}" data-ordem-titulo="${h(c.titulo)}"
      style="--cor:var(--${h(c.divisao_principal)})">
    <a href="${raiz}caso/${h(c.slug)}.html">
      <span class="card-faixa" aria-hidden="true"></span>
      <div class="corpo">
        <p class="card-divisao">${rotuloDivisao(c.divisao_principal)}</p>
        <h3>${h(c.titulo)}</h3>
        <p class="card-resumo">${h((c.resumo.match(/^.*?[.!?](?=\s|$)/) || [c.resumo])[0])}</p>
      </div>
      <div class="card-rodape">
        <span>${plural(c.afirmacoes.length, "registro", "registros")}</span>
        <span class="cap-ler">Abrir <span aria-hidden="true">→</span></span>
      </div>
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
    caminho: "grafo.html",
    descricao: "Quem aparece com quem no caso Banco Master: entidades como nós, afirmações como ligações.",
    profundidade: 0,
    visualizacao: "grafo",
    extraHead: `<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>`,
    corpo: `
<div class="grafo-topo">
  <h1>Grafo <small id="grafo-contagem">${grafo.nodes.length} entidades · ${grafo.links.length} ligações</small></h1>
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
    <h3>Registros considerados</h3>
    <div class="naturezas">${Object.keys(NATUREZAS).map((k) => `<label class="ck"><input type="checkbox" name="g-natureza" value="${k}" checked> ${rotuloNatureza(k)}</label>`).join("")}</div>
    <label class="campo">De <input type="date" id="g-de"></label>
    <label class="campo">Até <input type="date" id="g-ate"></label>
    <p class="campo"><button type="button" id="g-limpar">Mostrar tudo</button></p>
  </aside>
  <p id="grafo-vazio" class="vazio" hidden>Nenhuma ligação com esses filtros.</p>
</div>
<p><small>Cada nó é uma entidade; cada ligação, uma ou mais afirmações que citam as duas. O tamanho do nó cresce com o número de ligações. Passe o mouse para acender as ligações de um nó; aproxime o zoom para ler os rótulos; arraste para reorganizar.</small></p>`,
    extraScript: `
<script>
(function(){
  var DADOS=${json({
    nodes: grafo.nodes,
    links: grafo.links.map((l) => ({
      source: l.source, target: l.target, peso: l.peso,
      afr: l.afirmacoes.map((id) => {
        const a = afrPorId.get(id), caso = (casosDaAfirmacao.get(id) || [])[0];
        return { id, d: a?.data || "", db: dataBR(a?.data), n: a?.natureza || "", t: resumoCurto(a?.texto || "", 150),
                 u: caso ? `caso/${caso.slug}.html#${id}` : `linha-do-tempo.html#${id}` };
      }),
    })),
  })};
  var NATUREZAS=${json(NATUREZAS)};
  var NOMES=${json(Object.fromEntries(Object.entries(DIVISOES).map(([k, v]) => [k, v.nome])))};
  var ORDEM=${json(Object.keys(DIVISOES))};
  var RAIZ=${json(raiz)};
  var svg=d3.select('#grafo'),painel=document.getElementById('grafo-painel'),modoSel=document.getElementById('modo-grafo'),agrupar=document.getElementById('agrupar-grafo');
  var aj={};['tamanho','espessura','rotulos','centro','repulsao','ligacao','distancia'].forEach(function(k){aj[k]=document.getElementById('g-'+k);});
  var busca=document.getElementById('g-busca');
  var sim=null,zoom=null,g=null,no=null,rotulos=null,link=null,nodes=[],links=[],selecionado=null,pairando=null,ticks=0,geracao=0,ancoras={},k=1,ocultos={},divisaoAtual='';
  function naturezasAtivas(){
    return Array.prototype.slice.call(document.querySelectorAll('input[name=g-natureza]:checked')).map(function(i){return i.value;});
  }
  function filtroAtivo(){
    return naturezasAtivas().length<Object.keys(NATUREZAS).length||document.getElementById('g-de').value||document.getElementById('g-ate').value;
  }
  function passaAfirmacao(a){
    if(naturezasAtivas().indexOf(a.n)<0)return false;
    var de=document.getElementById('g-de').value,ate=document.getElementById('g-ate').value;
    if(de&&(!a.d||a.d<de))return false;
    if(ate&&(!a.d||a.d>ate))return false;
    return true;
  }
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
      +(viz.length?'<ul class="painel-viz">'+viz.map(function(v){
          return '<li><button type="button" class="ver-ligacao" data-a="'+n.id+'" data-b="'+v[0].id+'">'+v[0].nome+' <small>('+v[1]+')</small></button></li>';
        }).join('')+'</ul>':'')
      +'<p><a href="'+RAIZ+'entidade/'+n.id+'.html">Abrir página →</a></p>'
      +'<div class="painel-afirmacoes" id="painel-afirmacoes" hidden></div>';
    painel.hidden=false;
    painel.querySelector('.fechar').addEventListener('click',limpar);
    painel.querySelectorAll('.ver-ligacao').forEach(function(b){
      b.addEventListener('click',function(){mostrarLigacao(b.dataset.a,b.dataset.b,b);});
    });
  }
  // Clicar num vizinho abre as afirmações que sustentam aquela ligação: é o dado por trás da aresta.
  function mostrarLigacao(a,b,botao){
    var l=links.find(function(x){
      var s=x.source.id||x.source,t=x.target.id||x.target;
      return (s===a&&t===b)||(s===b&&t===a);
    });
    var caixa=document.getElementById('painel-afirmacoes');
    painel.querySelectorAll('.ver-ligacao').forEach(function(x){x.setAttribute('aria-expanded',x===botao?'true':'false');});
    if(!l||!caixa)return;
    caixa.innerHTML='<h4>'+(l.afr.length===1?'1 afirmação liga os dois':l.afr.length+' afirmações ligam os dois')+'</h4>'
      +'<ul>'+l.afr.map(function(x){
        return '<li><span class="natureza natureza-'+x.n+'">'+(NATUREZAS[x.n]||x.n)+'</span> <time datetime="'+(x.d||'')+'">'+(x.db||'')+'</time>'
          +'<a href="'+RAIZ+x.u+'">'+x.t+'</a></li>';
      }).join('')+'</ul>';
    caixa.hidden=false;
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
    links=DADOS.links.filter(function(l){return ids.has(l.source)&&ids.has(l.target);})
      .map(function(l){var afr=l.afr.filter(passaAfirmacao);return Object.assign({},l,{afr:afr,peso:afr.length});})
      .filter(function(l){return l.peso>0;});
    // um nó sem nenhuma ligação depois do filtro sai do desenho, para não virar poeira solta
    if(filtroAtivo()){
      var ligados=new Set();links.forEach(function(l){ligados.add(l.source);ligados.add(l.target);});
      nodes=nodes.filter(function(n){return ligados.has(n.id);});
    }
    nodes.forEach(function(n){n.grau=0;});
    var porId={};nodes.forEach(function(n){porId[n.id]=n;});
    links.forEach(function(l){if(porId[l.source])porId[l.source].grau+=l.peso;if(porId[l.target])porId[l.target].grau+=l.peso;});
    var cont=document.getElementById('grafo-contagem');
    if(cont)cont.textContent=nodes.length+' entidades · '+links.length+' ligações';
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
  document.querySelectorAll('input[name=g-natureza]').forEach(function(i){
    i.addEventListener('change',function(){desenhar(document.getElementById('filtro-divisao').value);});
  });
  ['g-de','g-ate'].forEach(function(id){
    document.getElementById(id).addEventListener('change',function(){desenhar(document.getElementById('filtro-divisao').value);});
  });
  document.getElementById('g-limpar').addEventListener('click',function(){
    document.querySelectorAll('input[name=g-natureza]').forEach(function(i){i.checked=true;});
    document.getElementById('g-de').value='';document.getElementById('g-ate').value='';
    desenhar(document.getElementById('filtro-divisao').value);
  });
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
          <summary>${linkCaso(c, raiz)} <small>${plural(afrs.length, "registro", "registros")}</small></summary>
          <ul>${afrs.map((a) => renderAfirmacaoCurta(a, c, raiz)).join("")}</ul>
        </details>`;
      }).join("") : `<p class="vazio">Sem casos.</p>`;
      return `
      <details>
        <summary>${linkEntidade(e.id, raiz)} <small>${plural(seusCasos.length, "caso", "casos")} · ${plural(afirmacoesDaEntidade(e.id).length, "registro", "registros")}</small></summary>
        ${corpoCasos}
      </details>`;
    }).join("") : `<p class="vazio">Nenhuma entidade nesta divisão ainda.</p>`;
    return `
    <details open data-divisoes="${divId}">
      <summary class="divisao-titulo" style="--cor:var(--${divId})">${h(d.nome)} <small>${plural(ents.length, "entidade", "entidades")}</small></summary>
      ${corpoEnts}
    </details>`;
  }).join("");
  return pagina({
    titulo: "Árvore",
    caminho: "arvore.html",
    descricao: "De onde o caso Banco Master partiu e em que assuntos se dividiu, no tempo.",
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
    tipo: "article",
    caminho: `caso/${c.slug}.html`,
    descricao: (c.resumo || "").slice(0, 200),
    migalhas: [{ nome: "Início", href: `${raiz}index.html` }, { nome: "Casos", href: `${raiz}casos.html` }, { nome: c.titulo }],
    extraScript: `<script>window.TRILHAS=${json(trilhasResolvidas.map((t) => ({ id: t.id, titulo: t.titulo, casos: t.cs.map((x) => x.slug), titulos: t.cs.map((x) => x.titulo) })))};</script>
<script>${SCRIPT_TRILHA}</script>`,
    corpo: `
<nav id="barra-trilha" class="barra-trilha" data-slug="${h(c.slug)}" data-raiz="${raiz}" aria-label="Trilha de leitura" hidden></nav>
<article class="caso duas-colunas">
  <div class="prosa">
    <p>${rotuloDivisao(c.divisao_principal)}</p>
    <h1>${h(c.titulo)}</h1>
    ${c.imagem?.arquivo ? imagemOuPlaceholder(c, raiz) : ""}
    <p class="resumo">${h(c.resumo)}</p>
    <h2>Afirmações <small>${afrs.length}</small></h2>
    ${avisoInline()}
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
    caminho: `entidade/${e.id}.html`,
    descricao: `${e.nome}: ${e.descricao || DIVISOES[e.grupo]?.nome || ""} ${plural(afrs.length, "registro", "registros")} no caso Banco Master.`,
    migalhas: [{ nome: "Início", href: `${raiz}index.html` }, { nome: "Quem é quem", href: `${raiz}quem-e-quem.html` }, { nome: e.nome }],
    corpo: `
<article class="entidade-pagina duas-colunas">
  <div class="prosa">
    <p>${rotuloDivisao(e.grupo)} <small>· ${h(e.tipo)} ·</small> ${selo(e)}</p>
    <h1>${h(e.nome)}</h1>
    ${e.descricao ? `<p class="descricao">${h(e.descricao)}</p>` : ""}
    <h2>Afirmações <small>${afrs.length}</small></h2>
    ${afrs.length ? avisoInline() + afrs.map((a) => renderAfirmacao(a, raiz)).join("\n") : `<p class="vazio">Nenhuma afirmação registrada.</p>`}
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
mkdirSync(join(SITE, "capitulo"), { recursive: true });
mkdirSync(join(SITE, "trilha"), { recursive: true });
if (existsSync(IMAGENS)) cpSync(IMAGENS, join(SITE, "imagens"), { recursive: true });

const escreve = (rel, html) => { writeFileSync(join(SITE, rel), html); return rel; };
writeFileSync(join(SITE, "indice-busca.js"), `window.INDICE_BUSCA=${json(indiceBusca)};`);
gerarCapa(join(SITE, "capa.png"));
const geradas = [
  escreve("index.html", paginaInicial()),
  escreve("linha-do-tempo.html", paginaLinhaDoTempo()),
  escreve("quem-e-quem.html", paginaQuemEQuem()),
  escreve("trilhas.html", paginaTrilhas()),
  ...trilhasResolvidas.map((t) => escreve(join("trilha", `${t.id}.html`), paginaTrilha(t))),
  escreve("entenda.html", paginaEntenda()),
  escreve("entenda-completo.html", paginaEntendaCompleto()),
  ...introducao.capitulos.map((c, i) => escreve(join("capitulo", `${c.id}.html`), paginaCapitulo(c, i))),
  escreve("sobre.html", paginaSobre()),
  escreve("fontes.html", paginaFontes()),
  escreve("correcoes.html", paginaCorrecoes()),
  escreve("casos.html", paginaCasos()),
  escreve("grafo.html", paginaGrafo()),
  escreve("arvore.html", paginaArvore()),
  ...casos.map((c) => escreve(join("caso", `${c.slug}.html`), paginaCaso(c))),
  ...entidades.map((e) => escreve(join("entidade", `${e.id}.html`), paginaEntidade(e))),
];

// ---------- sitemap e robots ----------
const baseUrl = (projeto.url || "").replace(/\/$/, "");
if (baseUrl) {
  const urls = geradas.map((rel) => rel.split(sep).join("/"));
  writeFileSync(join(SITE, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${baseUrl}/${u === "index.html" ? "" : u}</loc>${dataDaBase ? `<lastmod>${dataDaBase}</lastmod>` : ""}</url>`).join("\n") +
    `\n</urlset>\n`);
  writeFileSync(join(SITE, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${baseUrl}/sitemap.xml\n`);
}

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
