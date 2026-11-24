import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SuperzooClient } from '../dist/client.js';
import { createServer } from '../dist/server.js';

const categoryId = '7e43e545-85f0-4b57-97a4-8a402743d088';
const scopeId = 'df78818c-bd2b-49aa-8827-78fce607bf1b';
const alias = 'akvaristika/dekoracie-do-akvaria';
const facets = {
  parameters: [{ id: 'length', alias: 'dlzka', values: [{ value: '14', count: 1, increment: false }] }, {
    id: 'color', alias: 'farba', values: [{ value: 'hneda', count: 1 }, { value: 'zelena', count: 1 }],
  }, { id: 'suction', alias: 'prisavka', values: [{ value: '1', count: 1 }] }],
  brands: { values: [{ id: 'brand-id', count: 1 }] },
  categories: { values: [{ id: 'child-id', count: 1 }] },
  campaigns: { values: [{ id: 'campaign-id', count: 1 }] },
  tags: { values: [{ id: 'tag-id', count: 1 }] },
  review: { values: [{ value: 5, count: 1 }] },
  price: { global: { min: '1.53', max: '60.90' }, filtered: { min: '1.53', max: '60.90' } },
};

test('MCP discovers aquarium filters and applies them to paged keyword candidates', async t => {
  const browseRequests = [];
  const rankedIds = Array.from({ length: 11 }, (_, index) => `product-${index + 1}`);
  const api = new SuperzooClient({ country: 'SK', logRequests: false, fetchImpl: async (url, init) => {
    const address = new URL(url);
    if (address.pathname.endsWith('/navigation/animal-category')) {
      return Response.json({ items: [{ categoryType: 'aquaristics', text: 'Akvaristika', children: [
        { id: categoryId, name: 'Dekorácie', nodeType: 'productCategory', alias },
        { id: 'unnamed', name: '', nodeType: 'productCategory', alias: 'akvaristika/pozadie' },
      ] }] });
    }
    if (address.pathname.startsWith('/collections/route/')) {
      assert.deepEqual(JSON.parse(init.body), { ids: [alias] });
      return Response.json({ items: [{ route: { alias, settings: {
        templateId: 'productCatalogue:category:CATEGORY', resourceId: scopeId,
      } } }] });
    }
    if (address.pathname.endsWith('/search')) {
      const term = address.searchParams.get('term');
      if (term === 'no-results') return Response.json({ totalCount: 0, items: [] });
      assert.equal(term, 'hrad');
      const item = id => ({ id, type: 'productCatalogue.product', title: id, alias: id });
      return Response.json({ totalCount: 250, items: [...rankedIds.map(item), item(rankedIds[0]),
        { ...item('restricted'), attributes: { productSaleForbidden: true } }] });
    }
    if (address.pathname.endsWith('/products/parameter-filter')) {
      const request = JSON.parse(init.body);
      assert.deepEqual(request.facets, facets);
      if (!request.scope) return new Response(null, { status: 400 });
      return Response.json({ parameters: [{ id: 'length', name: 'Dĺžka', type: 'number', alias: 'dlzka',
        values: [{ name: '14 cm', value: 14 }] }, {
        id: 'suction', name: 'Prísavka', type: 'boolean', alias: 'prisavka', values: [{ name: 'Áno', value: '1' }],
      }],
      brands: { values: [{ value: 'brand-id', name: 'Brand' }] } });
    }
    if (address.pathname.startsWith('/filter-products/')) {
      const body = JSON.parse(init.body);
      if (body.paging.limit === 1) return Response.json({ products: [{ id: rankedIds[0] }], totalCount: 11, facets });
      assert.match(init.body, /"from":0\.0,"to":15\.0/);
      assert.match(init.body, /"from":0\.0,"to":20\.0/);
      browseRequests.push(body);
      const ids = body.paging.page === 1 ? rankedIds.slice(0, 10) : rankedIds.slice(10);
      return Response.json({ products: ids.map(id => ({ id })), totalCount: rankedIds.length });
    }
    assert.match(address.pathname, /^\/collections\/product\//);
    return Response.json({ items: JSON.parse(init.body).ids.map(id => ({
      product: { productId: id, name: 'Hrad', alias: 'hrad', published: true,
        productSaleForbidden: false, disallowedPriceLevels: [] },
      prices: [{ productId: id, webId: 'superzoo_sk', priceLevelId: '22' }],
    })) });
  } });
  const server = createServer(api);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'catalogue-test', version: '1.0.0' });
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, undefined, JSON.stringify(result.content));
    return result.structuredContent;
  };

  const categories = await call('list_product_categories', { department: 'aquaristics' });
  assert.equal(categories.categories[0].category_id, categoryId);
  assert.equal(categories.categories[1].name, 'akvaristika/pozadie');
  const discovery = await call('list_product_categories', { category_id: categoryId });
  assert.deepEqual(discovery.filters.parameters.find(parameter => parameter.key === 'dlzka'), {
    id: 'length', key: 'dlzka', name: 'Dĺžka', type: 'number', values: [{ value: '14', count: 1, name: '14 cm' }],
  });
  assert.deepEqual(discovery.filters.price, { min: '1.53', max: '60.90', currency: 'EUR' });

  const selection = {
    category_id: categoryId, query: 'hrad',
    facets: { dlzka: { from: 0, to: 15 }, farba: ['hneda', 'zelena'] },
    brands: ['brand-id'], catalogue_price: { from: 0, to: 20 }, only_in_stock: true,
    subcategories: ['child-id'], campaigns: ['campaign-id'], tags: ['tag-id'], ratings: [5],
  };
  const first = await call('browse_products', selection);
  const second = await call('browse_products', { ...selection, page: first.next_page });
  assert.deepEqual(browseRequests[0].scope, { category: scopeId, productIds: rankedIds });
  assert.deepEqual(browseRequests[0].query, {
    brands: ['brand-id'], price: [{ from: 0, to: 20 }],
    categories: ['child-id'], campaigns: ['campaign-id'], tags: ['tag-id'], reviews: [5],
    parameters: [{ alias: 'dlzka', values: [{ from: 0, to: 15 }] }, { alias: 'farba', values: ['hneda', 'zelena'] }],
  });
  assert.deepEqual(browseRequests[0].sort, { sortBy: 'idsList', order: 'asc' });
  assert.equal(browseRequests[0].filters.onlyInStock, true);
  assert.deepEqual(browseRequests[1], { ...browseRequests[0], paging: { page: 2, limit: 10 } });
  assert.equal(first.candidate_limit_reached, true);
  assert.equal(first.next_page, 2);
  assert.equal(second.next_page, null);
  assert.deepEqual([...first.products, ...second.products].map(product => product.product_id), rankedIds);

  const invalidRange = await client.callTool({ name: 'browse_products', arguments: {
    category_id: categoryId, facets: { prisavka: { from: 0, to: 1 } },
  } });
  assert.equal(invalidRange.isError, true);
  assert.equal(JSON.parse(invalidRange.content[0].text).code, 'invalid_input');

  const keywordDiscovery = await call('list_product_categories', { query: 'hrad' });
  assert.equal(keywordDiscovery.labels_available, false);
  assert.deepEqual(keywordDiscovery.filters.brands, [{ id: 'brand-id', count: 1 }]);
  const empty = await call('browse_products', { query: 'no-results' });
  assert.deepEqual(empty.products, []);
  assert.equal(empty.next_page, null);
  assert.equal(browseRequests.length, 2);
});
