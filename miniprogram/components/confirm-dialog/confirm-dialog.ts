Component({properties:{visible:Boolean,title:String,message:String},methods:{cancel(){this.triggerEvent('cancel');},confirm(){this.triggerEvent('confirm');}}});
