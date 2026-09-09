# Base de dados — Caso Banco Master

Estrutura para reunir informação verificável sobre o caso, de forma que
grafo, linha do tempo e páginas individuais sejam **projeções da mesma base**.

## Princípio

O site não julga mérito. Ele registra, para cada informação:
o que foi dito, **quem disse**, quando, com **qual fonte**, e o que
respondeu quem foi citado. O julgamento fica com quem lê.

Por isso os campos abaixo não são opinião — são metadados verificáveis.

## Arquivos

    dados/fontes.json       — registro de fontes (a base de tudo)
    dados/entidades.json    — pessoas e organizações (só o que elas são)
    dados/afirmacoes.json   — a unidade atômica do conteúdo
    validar.mjs             — checa integridade e deriva o grafo

Rodar: `node validar.mjs` (sai com código 1 se houver erro).

## As três entidades

### Fonte

Registro de onde a informação veio. O campo `nivel` é a hierarquia:

| nível | tipo | exemplo |
|---|---|---|
| 1 | documento primário | petição da PF, decisão do STF, ata de CPI |
| 2 | jornalismo com apuração própria | JOTA, Agência Pública, Reuters |
| 3 | jornalismo de retranca / balanço | matéria explicativa que consolida |
| 4 | agregador | Wikipédia — só como ponto de partida |

Nível 4 nunca sustenta sozinho uma afirmação publicada. Serve para você
descobrir o que existe e então rastrear até a fonte real.

### Entidade

Pessoa ou organização. Contém **apenas o que a entidade é** — cargo,
histórico factual, papel. Nenhuma acusação vive aqui. Isso é deliberado:
mantém o cadastro estável e impede que alegações se colem à identidade
de alguém como se fossem atributo permanente.

### Afirmação

A unidade atômica. Uma informação, com sua procedência.

- `texto` — a frase, redigida conforme a natureza (ver abaixo)
- `natureza` — `fato` | `alegacao` | `decisao` | `arquivado` | `desmentido`
- `alegado_por` — quem alega (obrigatório quando natureza = alegacao)
- `envolve` — ids das entidades citadas → **é o que gera o grafo**
- `fontes` — ids das fontes que sustentam
- `resposta_do_citado` — manifestação da defesa/gabinete
- `historico` — correções feitas, nunca apagadas

## Natureza: a distinção que sustenta o site

- **fato** — aconteceu e é verificável. "Vorcaro foi preso em 17/11/2025."
  Redigir no indicativo.
- **decisao** — ato formal de um órgão. "O STF determinou o bloqueio."
- **alegacao** — alguém afirma, ainda não é fato estabelecido.
  "Teria recebido…", sempre com `alegado_por` preenchido.
  Redigir no futuro do pretérito, nunca no indicativo.
- **arquivado** — a apuração terminou sem prosseguimento.
- **desmentido** — foi refutado. **Permanece no site**, marcado.

Apagar uma afirmação desmentida é reescrever a história. Marcá-la
como desmentida é fazer jornalismo.

## Regras editoriais (aplicadas pelo validador)

Bloqueiam publicação (erro):
- afirmação sem fonte
- alegação sem `alegado_por`
- referência a entidade ou fonte inexistente

Exigem revisão (aviso):
- alegação sobre pessoa sem resposta do citado registrada
- alegação com fonte única
- afirmação apoiada só em agregador

Essas regras são a sua proteção. Elas transformam "eu tomo cuidado"
em algo que o computador verifica antes de cada publicação.

## Por que o grafo não é escrito à mão

As arestas emergem do campo `envolve`. Duas entidades citadas na mesma
afirmação viram uma ligação, com peso igual ao número de afirmações
que as conectam. Consequência: o grafo **nunca fica dessincronizado**
do conteúdo, e o peso visual reflete densidade real de evidência,
não impressão sua.

## Ordem sugerida de trabalho

1. Preencher 20–30 afirmações à mão, rodando o validador a cada uma.
   O objetivo é estressar o schema, não ter conteúdo bonito.
2. Renderizar a linha do tempo em HTML sem estilo nenhum.
3. Renderizar o grafo a partir das arestas derivadas.
4. Só então design.
5. Só então pensar em automação de coleta.

## Pendências antes de publicar qualquer coisa

- [ ] Definir e escrever a política de correção
- [ ] Definir e escrever a política de direito de resposta
- [ ] Decidir a regra de entrada: alegação sobre pessoa exige 2 fontes?
- [ ] Buscar manifestação da defesa das pessoas citadas
- [ ] Substituir as fontes nível 4 por fontes primárias
- [ ] Ler material da Abraji sobre proteção jurídica de quem publica

## Adições (set/2026)

### Caso

Agrupamento de afirmações com `titulo`, `slug`, `resumo`, `divisao_principal`,
`afirmacoes[]`, `casos_relacionados[]` e `imagem`. É o que vira card e página
de aprofundamento. Não afirma nada por conta própria — só agrupa.

Regra de título: se o caso contém só alegações, o título precisa soar como
alegação. O validador avisa quando o título parece afirmativo demais.

### Imagem

    "imagem": { "arquivo", "fonte", "licenca", "credito", "nota" }

Com `arquivo` preenchido, `licenca`, `credito` e `fonte` viram obrigatórios.
Sem `arquivo`, o site usa placeholder na cor da divisão.

### Fontes permitidas

`dados/fontes-permitidas.json` é a lista de domínios aceitos. O validador
bloqueia fonte fora dela. Para adicionar um domínio, adicione lá com nível e
justificativa. Domínios recusados ficam em `_recusados` com o motivo.

### Divisões

São exatamente cinco: `nucleo-master`, `politico`, `judiciario`,
`orgao-controle`, `instituicao-privada`. Cores e nomes no CLAUDE.md.
