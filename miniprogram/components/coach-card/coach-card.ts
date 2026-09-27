Component({properties:{hint:{type:Object,value:{}},expanded:{type:Boolean,value:false}},methods:{open(){this.triggerEvent('select',{level:(this.data.hint as {level:number}).level});}}});
