import test from 'node:test';
import assert from 'node:assert/strict';
import {financeTotals,prepareEventFinance} from '../src/lib/eventFinance.js';
test('approved leader lump example normalizes amounts and preserves prior payment metadata',()=>{
 const old={revenue:'350,000',payMethod:'leader_lump',leaderPay:{amount:'200000',status:'paid',paidAt:'previous'},extraCosts:[{label:'주차비',amount:'10000',receipt:'keep'}],workers:[{name:'기존 팀원'}],memo:'keep'};
 const saved=prepareEventFinance(old);assert.equal(saved.revenue,350000);assert.equal(saved.leaderPay.status,'paid');assert.equal(saved.leaderPay.paidAt,'previous');assert.equal(saved.extraCosts[0].receipt,'keep');assert.deepEqual(saved.workers,old.workers);assert.equal(saved.memo,'keep');assert.equal(financeTotals(saved).profit,140000);assert.equal(old.revenue,'350,000');
});
test('direct payment uses all member amounts while retaining inactive leader information',()=>{
 const saved=prepareEventFinance({revenue:'350000',payMethod:'member_direct',leaderPay:{amount:200000,status:'paid'},memberPays:[{employeeName:'A',amount:'100000',status:'paid'},{employeeName:'B',amount:'80000'}],extraCosts:[{label:'주차',amount:'10000'}]});
 assert.equal(financeTotals(saved).profit,160000);assert.equal(saved.memberPays[0].status,'paid');assert.equal(saved.leaderPay.status,'paid');
});
test('invalid, negative, fractional, overflowing amounts and incomplete payees cannot save; zero and losses are valid',()=>{
 const base={revenue:350000,leaderPay:{amount:200000},payMethod:'leader_lump'};
 for(const revenue of ['',-1,'1.2','abc','9007199254740992'])assert.throws(()=>prepareEventFinance({...base,revenue}));
 assert.throws(()=>prepareEventFinance({...base,payMethod:'member_direct',memberPays:[]}));
 assert.throws(()=>prepareEventFinance({...base,payMethod:'member_direct',memberPays:[{employeeName:'',amount:10}]}));
 assert.throws(()=>prepareEventFinance({...base,payMethod:'member_direct',memberPays:[{employeeName:'A',amount:10},{employeeName:'A',amount:20}]}));
 assert.throws(()=>prepareEventFinance({...base,extraCosts:[{label:'',amount:10}]}));
 assert.equal(financeTotals(prepareEventFinance({...base,revenue:0})).profit,-200000);
});
