Component({properties:{moment:{type:Object,value:{}}},methods:{select(){this.triggerEvent('select',{turn:(this.data.moment as {turn:number}).turn});}}});
