Component({properties:{message:{type:String,value:'暂时无法加载'}},methods:{retry(){this.triggerEvent('retry');}}});
