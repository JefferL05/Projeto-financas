# Projeto Finanças

Aplicação web de gestão financeira pessoal multi-moeda construída com HTML, CSS e JavaScript puro.

## Tecnologias

- HTML5
- CSS3 responsivo
- JavaScript ES Modules
- IndexedDB como banco local
- Chart.js para gráficos
- Service Worker + Manifest para PWA/offline
- Importação e exportação JSON
- Importação e exportação CSV
- API opcional de cotação BRL → PYG

## Recursos

- Entradas e saídas em PYG e BRL
- Dashboard multi-moeda
- Patrimônio consolidado
- Cotação manual e online
- Categorias personalizadas
- Tags
- Busca e filtros
- Smart Input para anotações brutas
- Analytics e projeções mensais
- Backup completo
- Histórico de câmbio
- IndexedDB com stores para transações, configurações, categorias e cotações
- Uso offline por Service Worker

## Executar localmente

Como o projeto usa ES Modules, abra com um servidor local:

```bash
python -m http.server 8080
```

Depois acesse `http://localhost:8080`.

Também pode ser publicado diretamente no GitHub Pages.
