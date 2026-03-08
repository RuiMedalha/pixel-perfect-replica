

## Problema

A imagem mostra dois problemas claros:

1. **Atributos não preenchidos**: A coluna "Atributo" mostra "—" para todas as variações porque o código só lê `attrs[0]?.value` (formato single-attribute antigo). Os atributos das variações filhas não foram preenchidos durante a aplicação/importação.

2. **Suporte multi-atributo no modal**: O tab de Variações só mostra uma coluna de atributo (`attrs[0]`), ignorando o formato multi-atributo.

3. **Publicação WooCommerce**: A edge function `publish-woocommerce` **já suporta** produtos variáveis — quando se publica um produto `variable`, ela automaticamente busca os filhos, constrói os atributos do pai (`buildAttributesForParent`) e publica cada variação com os seus atributos (`buildVariationAttributes`). Preço, sale_price e todos os campos são enviados. O problema é que se os atributos estiverem vazios na BD, vão vazios para o WooCommerce.

## Plano

### 1. Corrigir o tab Variações no ProductDetailModal

Substituir a lógica de coluna única por colunas dinâmicas baseadas nos `attribute_names` do produto pai:

- Ler `product.attributes` para obter a lista de nomes de atributos (ex: `[{name: "Cor", values: [...]}]`)
- Gerar uma coluna `<th>` por cada atributo
- Para cada variação filha, ler `child.attributes` (formato `[{name, value}]`) e mapear o valor correto para cada coluna
- No Preview WooCommerce, mostrar pills para cada atributo separadamente

### 2. Garantir que os atributos são preenchidos na importação/aplicação

Verificar `useApplyVariations` — o código já preenche `attributes` nos filhos com `[{name, value}]`. O problema é provavelmente que **os produtos existentes foram agrupados antes desta lógica existir**, e os atributos estão `null` ou vazios na BD.

### 3. Fallback no modal

Se `product.attributes` do pai não tiver a estrutura `[{name, values}]`, fazer fallback para extrair os nomes de atributo dos filhos (union de todos os `child.attributes[].name`).

### Ficheiros a editar

- `src/components/ProductDetailModal.tsx` — refatorar o tab Variações para multi-atributo dinâmico

