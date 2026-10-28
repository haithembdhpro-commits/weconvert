import test from 'node:test';
import assert from 'node:assert/strict';
import {orderAmount,csvCell,localInputToISO,errorMessage,initialsOf,requestId} from '../src/domain.mjs';
test('request identifiers remain valid and unique without randomUUID',()=>{
 const ids=Array.from({length:100},()=>requestId());
 assert.equal(new Set(ids).size,100);
 ids.forEach(id=>assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
});
test('COD amount uses cents and handles multiple lines, fees and discounts',()=>{
 assert.equal(orderAmount([{quantity:3,unit_price:0.1},{quantity:2,unit_price:1500.25}],500,100),3400.8);
});
test('CSV exports neutralize spreadsheet formulas and quote multiline customer text',()=>{
 assert.equal(csvCell('=HYPERLINK("https://example.invalid")'),'"\'=HYPERLINK(""https://example.invalid"")"');
 assert.equal(csvCell('+213555123456'),'"\'+213555123456"');
 assert.equal(csvCell('  =1+1'),'"\'  =1+1"');
 assert.equal(csvCell('A;B\nC'),'"A;B\nC"');
});
test('callbacks are absolute instants; invalid inputs cannot silently become now',()=>{
 assert.equal(localInputToISO('2026-10-26T10:30:00+01:00'),'2026-10-26T09:30:00.000Z');
 assert.throws(()=>localInputToISO(''),/INVALID_CALLBACK/);
});
test('concurrent write and network failures have actionable messages',()=>{
 assert.match(errorMessage({message:'VERSION_CONFLICT'}),/modifiée entre-temps/);
 assert.match(errorMessage({message:'Failed to fetch'}),/ne créera pas de doublon/);
 assert.match(errorMessage({message:'INSUFFICIENT_STOCK: Produit'}),/Stock disponible insuffisant/);
});
test('initials support Arabic and blank names without throwing',()=>{
 assert.equal(initialsOf('أحمد علي'),'أع');
 assert.equal(initialsOf('  '),'');
 assert.equal(initialsOf(null),'?');
});
