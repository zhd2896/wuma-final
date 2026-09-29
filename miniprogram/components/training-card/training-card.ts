Component({properties:{level:{type:Object,value:{}},stars:{type:String,value:'★★☆☆☆'}},methods:{open(){this.triggerEvent('select',{id:(this.data.level as {id:string}).id});}}});
