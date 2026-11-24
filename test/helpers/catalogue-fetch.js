const entries = [
  ['42eeee01-5544-4e68-8130-bef9755298ae', 'c1955f56-7438-4c93-8875-9dc8f634acd9',
    ['Granuly pre psov', 'Granule pro psy']],
  ['4a0f2a97-fe83-479e-b76d-65818f053d9b', '57377452-e778-43d0-9853-870bd5116ad3',
    ['Mokré krmivo', 'Konzervy a kapsičky']],
  ['4716d036-9322-41aa-975a-7a32a0735f0b', '927e5be1-9bd3-4d53-b710-af2966dd3958',
    ['Granuly pre mačky', 'Granule pro kočky']],
  ['dfc861d8-9069-47db-b29b-5d6afee06f1f', '19291e00-26e0-464b-bd6a-b804296ffb14',
    ['Podstielky', 'Stelivo pro kočky']],
];

export function catalogueFetch(country, fetchPage) {
  const sk = country === 'SK';
  const categoryFacets = [
    sk ? { 'vek-psa': ['dospely', 'senior', 'stena'], 'alergie-psa': ['bez-obilnin-grain-free'] }
      : { 'stari-psa': ['dospely', 'senior', 'stene'], alergie: ['bez-obilovin-grain-free-1'] },
    sk ? { 'vek-psa': ['dospely', 'senior', 'stena'] } : { 'stari-psa': ['dospely', 'senior', 'stene'] },
    sk ? { 'vek-macky': ['dospela-macka', 'starsia-macka', 'maciatko'] }
      : { 'stari-kocky': ['dospela-kocka', 'starsi-kocka', 'kote'] },
    sk ? { 'typ-podstielky': ['hrudkujuca'] } : { 'typ-steliva': ['hrudkujici'] },
  ];
  const groups = ['dogs', 'cats'].map((categoryType, index) => ({
    categoryType, text: categoryType,
    children: entries.slice(index * 2, index * 2 + 2).map(([id, , names]) =>
      ({ id, name: names[sk ? 0 : 1], alias: id, nodeType: 'productCategory' })),
  }));
  return async (url, options) => {
    const { pathname } = new URL(url);
    if (pathname.endsWith('/navigation/animal-category')) return Response.json({ items: groups });
    if (pathname.startsWith('/collections/route/')) {
      const { ids: [alias] } = JSON.parse(options.body);
      const entry = entries.find(([id]) => id === alias);
      return Response.json({ items: entry ? [{ route: { alias, settings: {
        resourceId: entry[1], templateId: 'productCatalogue:category:CATEGORY',
      } } }] : [] });
    }
    if (pathname.startsWith('/filter-products/')) {
      const body = JSON.parse(options.body);
      if (body.paging.limit === 1) {
        const index = entries.findIndex(([, scopeId]) => scopeId === body.scope.category);
        const parameters = Object.entries(categoryFacets[index]).map(([alias, values]) =>
          ({ id: alias, alias, values: values.map(value => ({ value, count: 1 })) }));
        return Response.json({ totalCount: 1, products: [], facets: { parameters } });
      }
    }
    if (pathname.endsWith('/products/parameter-filter')) return Response.json({});
    return fetchPage(url, options);
  };
}
