import test from 'node:test';
import assert from 'node:assert/strict';
import {total,currentPrice,orderFromRevision,escapeHTML} from '../src/domain.js';
test('exact decimal per-line rounding matches database rule',()=>{assert.equal(total([{cantidad:'3',precio_venta:'0.335'},{cantidad:'1',precio_venta:'0.005'}],'precio_venta'),'1.02');});
test('price validity uses inclusive start and exclusive end',()=>{const rows=[{producto_id:'a',vigente_desde:'2026-01-01',vigente_hasta:'2026-02-01',precio:10},{producto_id:'a',vigente_desde:'2026-02-01',vigente_hasta:null,precio:12}];assert.equal(currentPrice(rows,{producto_id:'a'},'2026-02-01').precio,12);assert.equal(currentPrice(rows,{producto_id:'b'},'2026-02-01'),undefined);});
test('editing an old revision keeps its data and uses current concurrency revision',()=>{const r={id:'old',datos:{operacion:{id:'order',revision:1},partidas:[{cantidad:3}],encabezados:{invoice:{folio:'A'}}}};const next=orderFromRevision(r,4);next.partidas[0].cantidad=9;assert.equal(r.datos.partidas[0].cantidad,3);assert.equal(next.revision,4);assert.equal(next.revision_origen_id,'old');});
test('catalog content is escaped for HTML rendering',()=>assert.equal(escapeHTML('<img src=x onerror="bad">'),'&lt;img src=x onerror=&quot;bad&quot;&gt;'));
