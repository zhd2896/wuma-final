import { openTab } from '../../utils/navigation';
Component({properties:{current:{type:String,value:'index'}},methods:{go(event: WechatMiniprogram.TouchEvent){const route=event.currentTarget.dataset.route as string;openTab(route);}}});
