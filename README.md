# Caso Master

Base de dados com procedência sobre o caso Banco Master / Daniel Vorcaro,
renderizada de quatro formas.

**No ar em [casobancomaster.com.br](https://casobancomaster.com.br)**

O site não julga mérito. Registra o que foi dito, quem disse, quando e com que
fonte — e deixa o julgamento para quem lê.

---

## O que há aqui

Este repositório tem os **dados** e o **gerador**. O site publicado fica em
[casomaster-site](https://github.com/PedroCaldas13/casomaster-site), que recebe
só o HTML gerado.

| | |
|---|---|
| Registros | 122, de outubro de 2022 a setembro de 2026 |
| Fontes | 200 — 61 de nível 1, 126 de nível 2, 13 de nível 3 |
| Entidades | 74 pessoas e organizações |
| Casos | 23 |
| Correções registradas | 17 |

Nenhuma linha de HTML é escrita à mão. Tudo sai de quatro arquivos JSON.

## A unidade atômica

Uma **afirmação** é uma informação com procedência. Ela tem uma `natureza`, e a
distinção entre elas é o que sustenta o site inteiro:

- **fato** — aconteceu e está documentado
- **decisao** — um ato de autoridade
- **alegacao** — alguém afirma; sempre com `alegado_por` e sempre no futuro do
  pretérito ("teria recebido"), nunca no indicativo

Uma alegação jamais é redigida como fato. Um título de caso nunca soa como fato
consumado se o caso só contém alegações. Isso não é estilo: o conteúdo cita
nominalmente ministros do STF, senadores e pessoas sob investigação e **não
condenadas**.

## O grafo é derivado, nunca desenhado

Duas entidades citadas na mesma afirmação viram uma aresta. O peso é o número de
afirmações que as conectam. Ninguém desenha ligação à mão — se o grafo mostra uma
conexão, existe um registro com fonte por trás dela.

O mesmo vale para a árvore e para a linha do tempo. As quatro visualizações leem
a mesma base e nenhuma tem dado próprio.

## As quatro visualizações

1. **Linha do tempo** — a sequência, com a natureza de cada registro visível
2. **Casos** — agrupamentos com resumo e aprofundamento
3. **Grafo** — entidades como nós, afirmações como arestas
4. **Árvore** — de onde o caso começou e para onde foi

## Rodar

Precisa de Node 18 ou mais novo. Sem dependências — o D3 do grafo vem de CDN.

```bash
node validar.mjs      # portão de qualidade; precisa passar antes de commit
node construir.mjs    # gera site/
node verificar-fontes.mjs   # checa se as 200 URLs ainda respondem
```

Para ver localmente:

```bash
python3 -m http.server 8765 --directory site
```

Para publicar:

```bash
./publicar.sh
```

O script valida, constrói e dá push da pasta `site/` no repositório público.
O `CNAME` do domínio é gerado pelo build a partir de `dados/projeto.json` — não
adicione à mão no GitHub, seria apagado na publicação seguinte.

## Arquivos

```
dados/fontes.json             fontes usadas, cada uma com link e nível
dados/fontes-permitidas.json  domínios aceitos — fonte fora da lista é erro
dados/entidades.json          pessoas e organizações: só o que elas SÃO
dados/afirmacoes.json         a unidade atômica
dados/casos.json              agrupamentos com título, resumo e imagem
dados/trilhas.json            percursos de leitura
dados/introducao.md           o caso explicado para quem nunca ouviu falar
dados/sobre.md                o que o site é e o que não é
dados/projeto.json            identidade, contato, URL, licença
validar.mjs                   portão de qualidade
construir.mjs                 gera o site
publicar.sh                   valida, constrói e publica
verificar-fontes.mjs          checa a saúde das URLs
```

[LEIA-ME.md](LEIA-ME.md) descreve a semântica de cada campo.
[CLAUDE.md](CLAUDE.md) tem as regras editoriais e o porquê de cada uma.

## Política de fontes

Só domínios listados em `dados/fontes-permitidas.json`. O validador bloqueia
qualquer outro, e domínios recusados ficam registrados com o motivo para não
serem reavaliados.

- **Nível 1** — o próprio órgão: PF, STF, Banco Central, MPF, Senado
- **Nível 2** — veículo com redação e apuração próprias
- **Nível 3** — veículo confiável, para consolidação
- **Nível 4** — agregador; nunca sustenta nada sozinho

Toda fonte tem URL. Sem exceção.

## Qualidade sem revisão manual

Manter uma revisão humana diária de tudo é trabalho que uma pessoa só não
sustenta. Em vez de uma marca genérica de "não conferida", que não informa nada,
o site examina os próprios registros a cada publicação e aponta o que falta em
cada um: **fonte única**, **sem resposta do citado**, **sem fonte primária**,
**fonte a confirmar**, **fonte sem data**.

O aviso some sozinho quando o dado melhora, sem ninguém marcar nada. O panorama
fica na página de qualidade. Expor a própria fraqueza automaticamente é mais
honesto do que prometer uma revisão que não vai acontecer.

## Correção não é silenciosa

Quando um registro muda, a mudança fica no `historico` dele, com data e motivo, e
aparece na página de Correções. Afirmação desmentida ou arquivada **nunca é
apagada**: muda de natureza e continua visível. Apagar seria reescrever a
história.

Encontrou um erro? Cada registro tem um botão que leva ao canal de correção com o
identificador já preenchido. Pessoas citadas que queiram apresentar sua versão
usam o mesmo caminho, e a manifestação entra junto do registro.

## Licença

O que foi escrito aqui e a organização da base estão sob
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.pt-br).

A licença não alcança o que não é nosso: as reportagens e documentos citados
pertencem a quem os publicou, e as fotos seguem cada uma a sua própria licença.

Se reusar, mantenha a fonte de cada afirmação junto dela.

## Arquitetura

Site estático. Sem backend, sem banco, sem login, sem formulários, sem analytics,
sem cookies, sem rastreadores. Deliberado: superfície de ataque perto de zero,
aguenta pico de tráfego, e o Git serve de histórico editorial auditável.

---

Projeto pessoal, sem fins lucrativos, sem publicidade e sem financiamento.
Mantido por Pedro Caldas.
