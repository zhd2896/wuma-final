Component({properties:{visible:Boolean,title:String,message:String,confirmText:{type:String,value:'确定'}},methods:{cancel(){this.triggerEvent('cancel');},confirm(){this.triggerEvent('confirm');}}});
