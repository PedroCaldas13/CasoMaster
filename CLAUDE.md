# Contexto do projeto

Site informativo sobre o caso Banco Master / Daniel Vorcaro. Projeto pessoal,
mantido por uma única pessoa, sem fins lucrativos.

**Objetivo:** reunir informação verificável de forma clara e coligada, para que
qualquer pessoa entenda o caso. O site **não julga mérito** — registra o que foi
dito, quem disse, quando e com que fonte. Quem julga é quem lê.

Não é jornalismo de opinião nem agregador de notícias. É uma base de dados com
procedência, renderizada de quatro formas.

## Por que o rigor importa

O conteúdo cita nominalmente senadores e ministros do STF, pessoas sob
investigação e **não condenadas**. Uma afirmação mal redigida, sem fonte ou com
imagem sem licença expõe o mantenedor a risco jurídico real. As regras abaixo
não são estilo — são a proteção do projeto.

## Arquitetura

Site estático. Sem backend, sem banco, sem login, sem formulários, sem analytics.
Deliberado: superfície de ataque perto de zero, aguenta pico de tráfego, e o Git
serve de histórico editorial auditável.

    dados/fontes.json             fontes usadas, cada uma com link e nível
    dados/fontes-permitidas.json  lista de domínios aceitos — fonte fora dela é erro
    dados/entidades.json          pessoas e organizações — só o que elas SÃO
    dados/afirmacoes.json         a unidade atômica: uma informação com procedência
    dados/casos.json              agrupamentos com título, resumo e imagem
    dados/pendentes.json          propostas aguardando revisão humana (pode não existir)
    validar.mjs                   portão de qualidade — precisa passar antes de commit
    construir.mjs                 gera o site

Ver LEIA-ME.md para a semântica de cada campo.

## Modelo de dados

**Afirmação** é a unidade atômica. Tem `natureza` (fato, decisao, alegacao,
arquivado, desmentido), `alegado_por` quando é alegação, `envolve` (ids de
entidades), `fontes`, `resposta_do_citado` e `historico` de correções.

**Caso** agrupa afirmações sob um título e um resumo — é o que aparece nos
cards e na visão de aprofundamento. Ex: "Vorcaro é preso e o Banco Master é
liquidado". Um caso não tem conteúdo próprio além de título, resumo e imagem;
tudo que afirma vem das afirmações que agrupa.

**Entidade** contém apenas o que a pessoa ou organização é. Nenhuma acusação
vive aqui.

**O grafo é derivado, nunca desenhado.** Duas entidades citadas na mesma
afirmação viram uma aresta. Peso = número de afirmações que as conectam.

## As cinco divisões

Toda entidade e todo caso pertence a uma. Cada uma tem uma cor fixa no site.

| id                    | nome                   | cor      |
|-----------------------|------------------------|----------|
| `nucleo-master`       | Núcleo Master          | `#9e3535` |
| `politico`            | Políticos              | `#8a4a86` |
| `judiciario`          | Judiciário             | `#3a5f9e` |
| `orgao-controle`      | Órgãos de controle     | `#2e6f4e` |
| `instituicao-privada` | Instituições privadas  | `#9a6209` |

Filtrar por divisão produz um subgrafo. Isso vale em todas as visualizações.

## As quatro visualizações

Todas leem a mesma base. Nenhuma tem dado próprio.

1. **Grafo** — entidades como nós, afirmações como arestas. Clicar num nó
   filtra as outras visualizações. É o modo "explorar conexões".
2. **Linha do tempo** — afirmações em ordem cronológica, com a natureza
   visível (fato vs alegação vs decisão). É o modo "entender a sequência".
3. **Casos** — cards com imagem, título e resumo curto. Clicar abre o
   aprofundamento: resumo completo, todas as afirmações do caso, fontes com
   link, e as ligações do caso agrupadas por divisão.
4. **Árvore** — hierarquia navegável: divisão → entidade → casos → afirmações.
   Colapsável. É o modo "ver a estrutura inteira de uma vez".

## Layout

- **Canto superior esquerdo:** seletor das quatro visualizações.
- **Canto superior direito:** busca por texto (entidades, casos, afirmações)
  com filtro por divisão.
- **Página inicial:** o intuito do site em poucas linhas, uma explicação breve
  do caso para quem nunca ouviu falar, e então a visualização padrão.
- **Cards de caso:** imagem, título, uma frase. Nada além disso — o
  aprofundamento é só ao clicar.
- **Aprofundamento:** resumo, afirmações com natureza e fonte, resposta dos
  citados, ligações por divisão, casos relacionados.
- **Aviso permanente:** ninguém citado foi condenado criminalmente até agora;
  investigação não é sentença. O "criminalmente" é necessário porque a CVM já
  aplicou multa administrativa a Vorcaro, ao pai, ao primo e ao banco; dizer
  apenas "condenado" seria impreciso. O "até agora" marca a data sem prever
  desfecho. Presente em todas as páginas, no rodapé, e repetido em letra
  pequena junto das listas de afirmações, onde há nomes de pessoas. Saiu do
  alto de cada página em set/2026, por decisão do mantenedor: o objetivo era
  reduzir o peso visual sem abrir mão da ressalva.

A visualização padrão da home é a **linha do tempo**, não o grafo: um leigo
abrindo um grafo de dezenas de nós se perde. O grafo é aprofundamento.

## Política de fontes

Só domínios listados em `dados/fontes-permitidas.json`. O validador bloqueia
qualquer outro. Critério: nível 1 é o próprio órgão (PF, STF, BC, MPF, Senado);
nível 2 é veículo com redação e apuração próprias; nível 3 é veículo confiável
usado para consolidação; nível 4 é agregador, só para descobrir o que existe.

Para usar um domínio novo: adicionar em `fontes-permitidas.json` com nível e
justificativa. Nunca contornar no código. Domínios recusados ficam registrados
em `_recusados` com o motivo, para não reavaliar.

Toda fonte tem URL. Sem exceção.

## Política de imagens

Fotos de pessoas e eventos em veículos de imprensa são protegidas por direito
autoral. **Sem licença compatível, sem imagem** — o validador bloqueia.

Fontes aceitáveis: Agência Brasil (CC BY 3.0 BR), Wikimedia Commons (verificar
a licença de cada arquivo), retratos oficiais de órgãos públicos (verificar
termos de uso no site do órgão). Toda imagem publicada exibe crédito e licença.

Um caso sem imagem é exibido com um placeholder neutro na cor da divisão.
Nunca use uma imagem "provisória" de origem desconhecida.

## Regras invioláveis

1. **Nenhuma afirmação sem fonte.**
2. **Alegação nunca é redigida como fato.** Futuro do pretérito ("teria
   recebido"), nunca indicativo, sempre com `alegado_por`.
3. **Título de caso segue a natureza do conteúdo.** Se o caso só contém
   alegações, o título não pode soar como fato consumado. "Vorcaro preso" é
   fato. "Wagner recebeu propina" não pode existir — "PF aponta vantagens a
   Wagner" pode.
4. **Nível 4 não sustenta nada sozinho.**
5. **Nunca apagar afirmação desmentida ou arquivada.** Mudar `natureza`,
   registrar em `historico`.
6. **Correção é registrada, não silenciada.**
7. **Imagem sem licença e crédito não é publicada.**
8. **`node validar.mjs` precisa passar antes de qualquer commit.**

## Sobre produzir conteúdo

**Não escreva em `dados/afirmacoes.json` nem em `dados/casos.json` a partir de
notícias.** A verificação humana contra a fonte é o valor do projeto.

Se for propor conteúdo (afirmações, casos, títulos, resumos), escreva em
`dados/pendentes.json` no mesmo formato, marcando `"proposto_por": "agente"`.
Nada sai de lá sem um humano conferir contra a fonte original e mover à mão.

Títulos e resumos de caso são texto editorial e seguem a regra 3. Propor é
permitido; publicar, não.

## Estilo de código

- JavaScript moderno (ESM). D3 via CDN para o grafo. Sem outras dependências
  até haver necessidade concreta e justificada.
- Sem framework enquanto o gerador estático der conta.
- Sem `localStorage`, sem analytics, sem scripts de terceiros além do D3.
- Legibilidade sobre esperteza — o mantenedor revisa tudo sozinho.
- Sem comentários óbvios; comente o *porquê* quando não for evidente.

## Roadmap

1. **Agora:** validar o schema preenchendo afirmações e casos à mão.
2. As quatro visualizações lendo a mesma base.
3. Busca e filtro por divisão.
4. Design.
5. Automação de coleta: fontes → extração → `pendentes.json` → revisão humana
   → publicação. Nunca publicação automática.
