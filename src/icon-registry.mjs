import {
 createElement,LayoutDashboard,ShoppingBag,PhoneCall,Truck,RotateCcw,Package,
 UsersRound,Wallet,ChartNoAxesCombined,BarChart3,MessagesSquare,Zap,Link2,
 Settings2,Search,ChevronRight,ChevronDown,ArrowUpRight,Plus,X,Check,
 CircleCheck,Bell,SlidersHorizontal,Download,Upload,CalendarDays,Moon,Sun,
 Menu,Pencil,Trash2,RefreshCw,EllipsisVertical,Store,Coins,Clock3,Info,
 FileText,Play,Printer,ScanLine,ShieldCheck,Target,Globe2,Copy,BookOpen,
 Heart,Tag,Archive,LogOut
} from 'lucide';

// Names are the existing CRM's semantic slots. Only icons actually used by the
// shipped UI are imported, so the browser never downloads the full catalogue.
const icons=Object.freeze({
 grid:LayoutDashboard,bag:ShoppingBag,phone:PhoneCall,truck:Truck,
 return:RotateCcw,box:Package,users:UsersRound,wallet:Wallet,
 chart:ChartNoAxesCombined,bars:BarChart3,message:MessagesSquare,bolt:Zap,
 link:Link2,settings:Settings2,search:Search,chevron:ChevronRight,
 down:ChevronDown,arrow:ArrowUpRight,plus:Plus,close:X,check:Check,
 checkcircle:CircleCheck,bell:Bell,filter:SlidersHorizontal,
 download:Download,upload:Upload,calendar:CalendarDays,moon:Moon,sun:Sun,
 menu:Menu,edit:Pencil,trash:Trash2,refresh:RefreshCw,dots:EllipsisVertical,
 store:Store,coins:Coins,clock:Clock3,info:Info,file:FileText,play:Play,
 print:Printer,scan:ScanLine,shield:ShieldCheck,target:Target,globe:Globe2,
 copy:Copy,book:BookOpen,heart:Heart,tag:Tag,archive:Archive,logout:LogOut
});

export function renderIcon(name,className=''){
 if(!Object.hasOwn(icons,name))throw new Error('Unknown CRM icon: '+name);
 return createElement(icons[name],{
  class:className||'wc-icon',width:20,height:20,'stroke-width':1.75,
  'aria-hidden':'true',focusable:'false'
 }).outerHTML;
}
