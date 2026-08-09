const DeliveryMap=(function(){
  let map,marker;
  function init(elId){
    let el=document.getElementById(elId);
    if(!el||typeof L==='undefined')return;
    map=L.map(elId).setView([33.3152,44.3661],6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap'}).addTo(map);
    map.on('click',e=>placeMarker(e.latlng.lat,e.latlng.lng));
    document.getElementById('use-my-location')?.addEventListener('click',()=>{
      if(!navigator.geolocation)return UI.toast('المتصفح لا يدعم تحديد الموقع');
      navigator.geolocation.getCurrentPosition(pos=>{
        placeMarker(pos.coords.latitude,pos.coords.longitude);
        map.setView([pos.coords.latitude,pos.coords.longitude],14);
      },()=>UI.toast('تعذر تحديد موقعك'));
    });
  }
  function placeMarker(lat,lng){
    if(marker)marker.setLatLng([lat,lng]);
    else marker=L.marker([lat,lng],{draggable:true}).addTo(map).on('dragend',()=>{
      let p=marker.getLatLng();placeMarker(p.lat,p.lng);
    });
    if(map.getZoom()<10)map.setView([lat,lng],14);
  }
  function getLocation(){
    if(!marker)return null;
    let p=marker.getLatLng();
    return{lat:p.lat,lng:p.lng};
  }
  return{init,getLocation};
})();
window.DeliveryMap=DeliveryMap;
