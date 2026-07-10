import React, { useState, useEffect } from 'react';
import { supabase } from './supabase';

function getNegocioId() {
  return new URLSearchParams(window.location.search).get('negocio');
}

const METODOS_PAGO = [
  { key:'efectivo', icon:'💵', label:'Efectivo', sub:'Paga al recibir' },
  { key:'qr',       icon:'📱', label:'QR',       sub:'Escanea y paga' },
  { key:'transferencia', icon:'🏦', label:'Transferencia', sub:'Transferencia bancaria' },
];

const estadoInfo = {
  nuevo:       { icon:'🕐', label:'En revisión',      color:'#F59E0B', bg:'#FEF3C7', desc:'El negocio está revisando tu pedido...' },
  preparacion: { icon:'👨‍🍳', label:'Aceptado ✅',     color:'#3B82F6', bg:'#DBEAFE', desc:'¡Tu pedido fue aceptado! Está siendo preparado.' },
  listo:       { icon:'🚚', label:'Listo para entregar', color:'#10B981', bg:'#D1FAE5', desc:'Tu pedido está listo y en camino.' },
  entregado:   { icon:'✅', label:'Entregado',         color:'#6B7280', bg:'#F3F4F6', desc:'¡Tu pedido fue entregado! Gracias.' },
  rechazado:   { icon:'❌', label:'Rechazado',         color:'#EF4444', bg:'#FEE2E2', desc:'Lo sentimos, tu pedido fue rechazado.' },
};

export default function App() {
  const [negocio, setNegocio] = useState(null);
  const [productos, setProductos] = useState([]);
  const [carrito, setCarrito] = useState([]);
  const [pantalla, setPantalla] = useState('catalogo');
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ nombre:'', telefono:'', direccion:'', nota:'', tipoEntrega:'delivery', metodoPago:'efectivo' });
  const [obteniendo, setObteniendo] = useState(false);
  const [productoDetalle, setProductoDetalle] = useState(null);
  const [cuponCodigo, setCuponCodigo] = useState('');
  const [cupon, setCupon] = useState(null);
  const [verificandoCupon, setVerificandoCupon] = useState(false);
  const [cuponError, setCuponError] = useState('');
  const [comprobante, setComprobante] = useState(null);
  const [comprobantePreview, setComprobantePreview] = useState(null);
  const [subiendoComprobante, setSubiendoComprobante] = useState(false);
  const [pedidoConfirmado, setPedidoConfirmado] = useState(null);
  const [estadoPedido, setEstadoPedido] = useState(null);
  const negocioId = getNegocioId();

  useEffect(() => {
    if (!negocioId) { setCargando(false); return; }
    const cargar = async () => {
      const { data: neg } = await supabase.from('negocios').select('*').eq('id', negocioId).single();
      const { data: prods } = await supabase.from('productos').select('*').eq('negocio_id', negocioId).eq('activo', true);
      setNegocio(neg); setProductos(prods || []); setCargando(false);
    };
    cargar();
  }, [negocioId]);

  useEffect(() => {
    if (!pedidoConfirmado) return;
    const intervalo = setInterval(async () => {
      const { data } = await supabase.from('pedidos').select('estado, motivo_rechazo, codigo_seguimiento').eq('id', pedidoConfirmado).single();
      if (data) setEstadoPedido(data);
    }, 5000);
    return () => clearInterval(intervalo);
  }, [pedidoConfirmado]);

  const agregarAlCarrito = (prod) => {
    setCarrito(prev => {
      const existe = prev.find(x => x.id === prod.id);
      if (existe) return prev.map(x => x.id===prod.id ? {...x, cant: x.cant+1} : x);
      return [...prev, { ...prod, cant: 1 }];
    });
    setProductoDetalle(null);
  };

  const cambiarCant = (id, delta) => {
    setCarrito(prev => prev.map(x => x.id===id ? {...x, cant: x.cant+delta} : x).filter(x => x.cant > 0));
  };

  const obtenerUbicacion = () => {
    if (!navigator.geolocation) { setError('Tu navegador no soporta GPS'); return; }
    setObteniendo(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords;
        setForm(prev => ({ ...prev, direccion: `https://maps.google.com/?q=${latitude},${longitude}`, gps: true }));
        setObteniendo(false);
      },
      () => { setError('No se pudo obtener ubicación.'); setObteniendo(false); }
    );
  };

  const verificarCupon = async () => {
    if (!cuponCodigo.trim()) return;
    setVerificandoCupon(true); setCuponError(''); setCupon(null);
    const { data } = await supabase.from('cupones').select('*').eq('negocio_id', negocioId).eq('codigo', cuponCodigo.toUpperCase().trim()).eq('activo', true).single();
    if (!data) { setCuponError('Cupón no válido o expirado'); setVerificandoCupon(false); return; }
    if (data.usos_actuales >= data.usos_maximos) { setCuponError('Este cupón ya alcanzó su límite'); setVerificandoCupon(false); return; }
    setCupon(data); setVerificandoCupon(false);
  };

  const quitarCupon = () => { setCupon(null); setCuponCodigo(''); setCuponError(''); };

  const seleccionarComprobante = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setComprobante(file);
    setComprobantePreview(URL.createObjectURL(file));
  };

  const costoDelivery = negocio?.costo_delivery ?? 15;
  const subtotal = carrito.reduce((s,x) => s + x.cant*x.precio, 0);
  const delivery = form.tipoEntrega === 'delivery' ? costoDelivery : 0;
  const descuento = cupon ? (cupon.tipo==='porcentaje' ? Math.round(subtotal * cupon.descuento / 100) : cupon.descuento) : 0;
  const totalFinal = Math.max(0, subtotal + delivery - descuento);
  const cantTotal = carrito.reduce((s,x) => s + x.cant, 0);
  const necesitaComprobante = form.metodoPago === 'qr' || form.metodoPago === 'transferencia';

  const confirmarPedido = async () => {
    if (!form.nombre || !form.telefono) { setError('Llena tu nombre y teléfono'); return; }
    if (form.tipoEntrega === 'delivery' && !form.direccion) { setError('Ingresa tu dirección'); return; }
    if (necesitaComprobante && !comprobante) { setError('Por favor sube el comprobante de pago'); return; }
    setEnviando(true); setError('');

    let comprobante_url = null;
    if (comprobante) {
      setSubiendoComprobante(true);
      const ext = comprobante.name.split('.').pop();
      const nombre = `comprobante-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('productos').upload(nombre, comprobante, { upsert: true });
      if (!uploadError) {
        const { data: urlData } = supabase.storage.from('productos').getPublicUrl(nombre);
        comprobante_url = urlData.publicUrl;
      }
      setSubiendoComprobante(false);
    }

    const { data: pedidoData, error: err } = await supabase.from('pedidos').insert({
      negocio_id: negocioId,
      cliente_nombre: form.nombre,
      cliente_telefono: form.telefono,
      cliente_direccion: form.tipoEntrega==='delivery' ? form.direccion : '🏪 Recoge en local',
      productos: carrito.map(x => ({ nombre: x.nombre, cant: x.cant, precio: x.precio })),
      total: totalFinal,
      estado: 'nuevo',
      metodo_pago: form.metodoPago,
      cupon_codigo: cupon ? cupon.codigo : null,
      descuento: descuento,
      comprobante_url,
      nota: `${form.tipoEntrega==='recoger'?'🏪 RECOGER EN LOCAL':'🚚 DELIVERY'} | 💳 ${form.metodoPago.toUpperCase()}${comprobante_url?' | ✅ COMPROBANTE':''}${form.nota?' | '+form.nota:''}`
    }).select().single();

    if (err) { setError('Error al enviar. Intenta de nuevo.'); setEnviando(false); return; }
    if (cupon) await supabase.from('cupones').update({ usos_actuales: cupon.usos_actuales + 1 }).eq('id', cupon.id);
    
    setPedidoConfirmado(pedidoData.id);
    setEstadoPedido({ estado: 'nuevo', motivo_rechazo: null });
    setEnviando(false);
    setPantalla('seguimiento');
  };

  if (!negocioId) return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(135deg,#1E293B,#2563EB)', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:16, padding:'2rem' }}>
      <div style={{ fontSize:72 }}>🛍</div>
      <div style={{ fontSize:26, fontWeight:800, color:'#fff' }}>PedidosFácil</div>
      <div style={{ fontSize:15, color:'rgba(255,255,255,0.7)', textAlign:'center', maxWidth:300 }}>Accede al link que te compartió el negocio.</div>
      <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginTop:8 }}>Creado por ALVARO R. MERLOS VALLEJOS · AX/CAPITALBOLIVIA</div>
    </div>
  );

  if (cargando) return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(135deg,#1E293B,#2563EB)', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:16 }}>
      <div style={{ fontSize:56 }}>🛍</div>
      <div style={{ fontSize:15, color:'rgba(255,255,255,0.9)', fontWeight:500 }}>Cargando menú...</div>
    </div>
  );

  if (!negocio) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:12 }}>
      <div style={{ fontSize:56 }}>😕</div>
      <div style={{ fontSize:18, fontWeight:700 }}>Negocio no encontrado</div>
    </div>
  );

  if (pantalla === 'seguimiento' && estadoPedido) {
    const info = estadoInfo[estadoPedido.estado] || estadoInfo.nuevo;
    return (
      <div style={{ minHeight:'100vh', background:'linear-gradient(135deg,#1E293B,#2563EB)', display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }}>
        <div style={{ background:'#fff', borderRadius:28, padding:'2.5rem 2rem', textAlign:'center', maxWidth:380, width:'100%', boxShadow:'0 24px 60px rgba(0,0,0,0.2)' }}>
          <div style={{ fontSize:64, marginBottom:16 }}>{info.icon}</div>
          <div style={{ fontSize:22, fontWeight:800, marginBottom:8 }}>{info.label}</div>
          <div style={{ fontSize:15, color:'#64748B', marginBottom:20 }}>{info.desc}</div>

          {estadoPedido.estado === 'rechazado' && estadoPedido.motivo_rechazo && (
            <div style={{ background:'#FEE2E2', borderRadius:12, padding:'12px', marginBottom:16, fontSize:14, color:'#DC2626' }}>
              Motivo: {estadoPedido.motivo_rechazo}
            </div>
          )}

          <div style={{ background:info.bg, borderRadius:16, padding:'1rem', marginBottom:20 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
              <span style={{ fontSize:13, color:'#64748B' }}>Negocio</span>
              <span style={{ fontSize:13, fontWeight:600 }}>{negocio.nombre}</span>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
              <span style={{ fontSize:13, color:'#64748B' }}>Cliente</span>
              <span style={{ fontSize:13, fontWeight:600 }}>{form.nombre}</span>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:13, color:'#64748B' }}>Total</span>
              <span style={{ fontSize:15, fontWeight:800, color:info.color }}>Bs. {totalFinal}</span>
            </div>
          </div>

          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:20 }}>
            {['nuevo','preparacion','listo','entregado'].map((paso, i) => {
              const inf = estadoInfo[paso];
              const pasos = ['nuevo','preparacion','listo','entregado'];
              const activo = estadoPedido.estado !== 'rechazado' && pasos.indexOf(estadoPedido.estado) >= i;
              return (
                <div key={paso} style={{ textAlign:'center', flex:1 }}>
                  <div style={{ width:32, height:32, borderRadius:'50%', background:activo?inf.color:'#E2E8F0', margin:'0 auto 4px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}>
                    {activo ? '✓' : i+1}
                  </div>
                  <div style={{ fontSize:9, color:activo?inf.color:'#94A3B8', fontWeight:activo?600:400, lineHeight:1.2 }}>{inf.label.split(' ')[0]}</div>
                </div>
              );
            })}
          </div>

          {estadoPedido.estado === 'nuevo' && (
            <div style={{ fontSize:12, color:'#94A3B8', marginBottom:16 }}>
              🔄 Actualizando automáticamente cada 5 segundos...
            </div>
          )}

          {(estadoPedido.estado === 'entregado' || estadoPedido.estado === 'rechazado') && (
            <button onClick={()=>{ setCarrito([]); setCupon(null); setCuponCodigo(''); setComprobante(null); setComprobantePreview(null); setPedidoConfirmado(null); setEstadoPedido(null); setForm({nombre:'',telefono:'',direccion:'',nota:'',tipoEntrega:'delivery',metodoPago:'efectivo'}); setPantalla('catalogo'); }}
              style={{ width:'100%', padding:'14px', borderRadius:14, border:'none', background:'linear-gradient(135deg,#2563EB,#7C3AED)', color:'#fff', fontWeight:800, fontSize:15, cursor:'pointer' }}>
              Hacer otro pedido
            </button>
          )}

          <div style={{ fontSize:11, color:'#94A3B8', marginTop:16 }}>
            Creado por ALVARO R. MERLOS VALLEJOS · AX/CAPITALBOLIVIA
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth:480, margin:'0 auto', minHeight:'100vh', background:'#F8FAFC', paddingBottom:80 }}>
      <div style={{ background:'linear-gradient(135deg,#1E293B,#2563EB)', padding:'1.5rem 1rem 3rem' }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontWeight:800, fontSize:22, color:'#fff' }}>{negocio.nombre}</div>
            <div style={{ fontSize:13, color:'rgba(255,255,255,0.75)', marginTop:4 }}>🏪 {negocio.tipo} · Pedidos online</div>
          </div>
          {pantalla !== 'catalogo' ? (
            <button onClick={()=>setPantalla(pantalla==='datos'?'carrito':'catalogo')}
              style={{ background:'rgba(255,255,255,0.15)', color:'#fff', border:'none', borderRadius:10, padding:'8px 14px', cursor:'pointer', fontSize:14, fontWeight:600 }}>
              ← Volver
            </button>
          ) : carrito.length > 0 && (
            <button onClick={()=>setPantalla('carrito')}
              style={{ background:'#fff', color:'#2563EB', border:'none', borderRadius:99, padding:'10px 18px', fontWeight:800, cursor:'pointer', fontSize:14, boxShadow:'0 4px 16px rgba(0,0,0,0.2)' }}>
              🛒 {cantTotal} · Bs. {subtotal}
            </button>
          )}
        </div>
        {pantalla !== 'catalogo' && (
          <div style={{ display:'flex', gap:6, marginTop:16 }}>
            {['carrito','datos'].map(p => (
              <div key={p} style={{ flex:1, height:3, borderRadius:99, background: pantalla===p||(p==='carrito'&&pantalla==='datos')?'#fff':'rgba(255,255,255,0.25)' }} />
            ))}
          </div>
        )}
      </div>

      {productoDetalle && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.65)', zIndex:200, display:'flex', alignItems:'flex-end', justifyContent:'center' }}
          onClick={e=>{ if(e.target===e.currentTarget) setProductoDetalle(null); }}>
          <div style={{ background:'#fff', borderRadius:'28px 28px 0 0', width:'100%', maxWidth:480, padding:'1.5rem', paddingBottom:'2.5rem' }}>
            {productoDetalle.foto_url ? (
              <img src={productoDetalle.foto_url} alt={productoDetalle.nombre} style={{ width:'100%', height:240, objectFit:'cover', borderRadius:18, marginBottom:'1.25rem' }} />
            ) : (
              <div style={{ width:'100%', height:180, background:'linear-gradient(135deg,#EFF6FF,#F5F3FF)', borderRadius:18, display:'flex', alignItems:'center', justifyContent:'center', fontSize:72, marginBottom:'1.25rem' }}>
                {productoDetalle.emoji||'📦'}
              </div>
            )}
            <div style={{ fontSize:24, fontWeight:800, marginBottom:4 }}>{productoDetalle.nombre}</div>
            <div style={{ fontSize:14, color:'#94A3B8', marginBottom:12 }}>{productoDetalle.categoria}</div>
            <div style={{ fontSize:28, fontWeight:800, color:'#2563EB', marginBottom:'1.5rem' }}>Bs. {productoDetalle.precio}</div>
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={()=>setProductoDetalle(null)} style={{ flex:1, padding:'14px', borderRadius:14, border:'1.5px solid #E2E8F0', background:'#fff', fontWeight:600, cursor:'pointer', fontSize:15, color:'#64748B' }}>Cerrar</button>
              <button onClick={()=>agregarAlCarrito(productoDetalle)} style={{ flex:2, padding:'14px', borderRadius:14, border:'none', background:'linear-gradient(135deg,#2563EB,#7C3AED)', color:'#fff', fontWeight:800, cursor:'pointer', fontSize:15 }}>+ Agregar al carrito</button>
            </div>
          </div>
        </div>
      )}

      {pantalla==='catalogo' && (
        <div style={{ padding:'1rem', marginTop:'-1.5rem' }}>
          {productos.length === 0 ? (
            <div style={{ textAlign:'center', padding:'4rem 2rem', color:'#94A3B8' }}>
              <div style={{ fontSize:56, marginBottom:12 }}>😔</div>
              <div style={{ fontWeight:700, fontSize:18 }}>No hay productos aún</div>
            </div>
          ) : (
            <>
              <div style={{ fontSize:13, color:'#64748B', marginBottom:'1rem', fontWeight:500 }}>{productos.length} productos disponibles</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                {productos.map(prod => {
                  const enCarrito = carrito.find(x=>x.id===prod.id);
                  return (
                    <div key={prod.id} onClick={()=>setProductoDetalle(prod)}
                      style={{ background:'#fff', borderRadius:20, overflow:'hidden', boxShadow:'0 2px 16px rgba(0,0,0,0.07)', cursor:'pointer', position:'relative' }}>
                      {prod.foto_url ? (
                        <img src={prod.foto_url} alt={prod.nombre} style={{ width:'100%', height:130, objectFit:'cover' }} />
                      ) : (
                        <div style={{ width:'100%', height:130, background:'linear-gradient(135deg,#EFF6FF,#F5F3FF)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:52 }}>
                          {prod.emoji||'📦'}
                        </div>
                      )}
                      {enCarrito && (
                        <div style={{ position:'absolute', top:8, right:8, background:'#2563EB', color:'#fff', borderRadius:99, fontSize:11, fontWeight:800, padding:'3px 8px' }}>
                          {enCarrito.cant} ✓
                        </div>
                      )}
                      <div style={{ padding:'10px 12px 14px' }}>
                        <div style={{ fontWeight:700, fontSize:14, marginBottom:2, color:'#1E293B', lineHeight:1.3 }}>{prod.nombre}</div>
                        <div style={{ fontSize:11, color:'#94A3B8', marginBottom:8 }}>{prod.categoria}</div>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                          <div style={{ fontWeight:800, color:'#2563EB', fontSize:17 }}>Bs. {prod.precio}</div>
                          <button onClick={e=>{ e.stopPropagation(); enCarrito ? cambiarCant(prod.id, 1) : agregarAlCarrito(prod); }}
                            style={{ width:34, height:34, borderRadius:'50%', border:'none', background:'linear-gradient(135deg,#2563EB,#7C3AED)', color:'#fff', fontSize:20, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, boxShadow:'0 4px 10px rgba(37,99,235,0.35)', flexShrink:0 }}>+</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {carrito.length > 0 && (
            <div style={{ position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)', width:'calc(100% - 2rem)', maxWidth:440, zIndex:50 }}>
              <button onClick={()=>setPantalla('carrito')}
                style={{ width:'100%', padding:'16px 24px', borderRadius:18, border:'none', background:'linear-gradient(135deg,#2563EB,#7C3AED)', color:'#fff', fontWeight:800, fontSize:16, cursor:'pointer', boxShadow:'0 8px 32px rgba(37,99,235,0.45)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <span>🛒 {cantTotal} productos</span>
                <span>Ver carrito · Bs. {subtotal}</span>
              </button>
            </div>
          )}
          <div style={{ textAlign:'center', fontSize:11, color:'#94A3B8', marginTop:'2rem' }}>
            Creado por ALVARO R. MERLOS VALLEJOS · AX/CAPITALBOLIVIA
          </div>
        </div>
      )}

      {pantalla==='carrito' && (
        <div style={{ padding:'1rem', marginTop:'-1.5rem' }}>
          <div style={{ fontWeight:800, fontSize:20, marginBottom:'1rem' }}>Tu carrito 🛒</div>
          <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:'1.25rem' }}>
            {carrito.map(x => (
              <div key={x.id} style={{ display:'flex', alignItems:'center', gap:12, background:'#fff', borderRadius:18, padding:'12px 14px', boxShadow:'0 2px 10px rgba(0,0,0,0.06)' }}>
                {x.foto_url ? <img src={x.foto_url} alt={x.nombre} style={{ width:56, height:56, borderRadius:12, objectFit:'cover', flexShrink:0 }} />
                  : <div style={{ width:56, height:56, borderRadius:12, background:'linear-gradient(135deg,#EFF6FF,#F5F3FF)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:28, flexShrink:0 }}>{x.emoji||'📦'}</div>}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:700, fontSize:14, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{x.nombre}</div>
                  <div style={{ fontSize:13, color:'#2563EB', fontWeight:600, marginTop:2 }}>Bs. {x.precio} c/u</div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
                  <button onClick={()=>cambiarCant(x.id,-1)} style={{ width:32, height:32, borderRadius:'50%', border:'2px solid #E2E8F0', background:'#fff', fontSize:17, cursor:'pointer', fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center' }}>−</button>
                  <span style={{ fontWeight:800, fontSize:16, minWidth:20, textAlign:'center' }}>{x.cant}</span>
                  <button onClick={()=>cambiarCant(x.id,1)} style={{ width:32, height:32, borderRadius:'50%', border:'none', background:'#2563EB', color:'#fff', fontSize:17, cursor:'pointer', fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
                </div>
                <div style={{ fontWeight:800, fontSize:15, minWidth:64, textAlign:'right' }}>Bs. {x.cant*x.precio}</div>
              </div>
            ))}
          </div>

          <div style={{ background:'#fff', borderRadius:16, padding:'1rem', marginBottom:'1rem', boxShadow:'0 2px 10px rgba(0,0,0,0.05)' }}>
            <div style={{ fontWeight:700, fontSize:14, marginBottom:10 }}>🎟️ ¿Tienes un cupón?</div>
            {cupon ? (
              <div style={{ background:'#F0FDF4', borderRadius:10, padding:'10px 14px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div>
                  <div style={{ fontWeight:700, color:'#059669', fontSize:14 }}>✅ {cupon.codigo} aplicado</div>
                  <div style={{ fontSize:13, color:'#64748B' }}>-{cupon.tipo==='porcentaje'?`${cupon.descuento}%`:`Bs. ${cupon.descuento}`} de descuento</div>
                </div>
                <button onClick={quitarCupon} style={{ border:'none', background:'transparent', color:'#DC2626', cursor:'pointer', fontSize:13, fontWeight:600 }}>Quitar</button>
              </div>
            ) : (
              <div style={{ display:'flex', gap:8 }}>
                <input value={cuponCodigo} onChange={e=>setCuponCodigo(e.target.value.toUpperCase())}
                  placeholder="Ingresa tu código" onKeyDown={e=>e.key==='Enter'&&verificarCupon()}
                  style={{ flex:1, padding:'10px 14px', borderRadius:10, border:'1.5px solid #E2E8F0', fontSize:14, outline:'none', fontWeight:600, letterSpacing:1 }} />
                <button onClick={verificarCupon} disabled={verificandoCupon}
                  style={{ padding:'10px 16px', borderRadius:10, border:'none', background:'#2563EB', color:'#fff', fontWeight:700, cursor:'pointer', fontSize:14 }}>
                  {verificandoCupon?'...':'Aplicar'}
                </button>
              </div>
            )}
            {cuponError && <div style={{ fontSize:12, color:'#DC2626', marginTop:6, fontWeight:500 }}>⚠️ {cuponError}</div>}
          </div>

          <div style={{ marginBottom:'1rem' }}>
            <div style={{ fontWeight:700, fontSize:15, marginBottom:10 }}>¿Cómo quieres recibirlo?</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              {[{key:'delivery',icon:'🚚',label:'Delivery',sub:`+Bs. ${costoDelivery}`,color:'#2563EB',bg:'#EFF6FF'},{key:'recoger',icon:'🏪',label:'Recoger',sub:'Sin costo',color:'#10B981',bg:'#F0FDF4'}].map(op=>(
                <button key={op.key} onClick={()=>setForm(p=>({...p,tipoEntrega:op.key,direccion:op.key==='recoger'?'Recoge en local':'',gps:false}))}
                  style={{ padding:'16px 12px', borderRadius:16, border:`2px solid ${form.tipoEntrega===op.key?op.color:'#E2E8F0'}`, background:form.tipoEntrega===op.key?op.bg:'#fff', cursor:'pointer', textAlign:'center' }}>
                  <div style={{ fontSize:30, marginBottom:6 }}>{op.icon}</div>
                  <div style={{ fontWeight:700, fontSize:14, color:form.tipoEntrega===op.key?op.color:'#1E293B' }}>{op.label}</div>
                  <div style={{ fontSize:12, color:'#94A3B8', marginTop:2 }}>{op.sub}</div>
                </button>
              ))}
            </div>
          </div>

          <div style={{ background:'#fff', borderRadius:16, padding:'1rem', marginBottom:'1.25rem', boxShadow:'0 2px 10px rgba(0,0,0,0.05)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:14, marginBottom:6, color:'#64748B' }}><span>Subtotal</span><span>Bs. {subtotal}</span></div>
            {delivery>0 && <div style={{ display:'flex', justifyContent:'space-between', fontSize:14, marginBottom:6, color:'#64748B' }}><span>Delivery</span><span>Bs. {delivery}</span></div>}
            {descuento>0 && <div style={{ display:'flex', justifyContent:'space-between', fontSize:14, marginBottom:6, color:'#10B981', fontWeight:600 }}><span>🎟 Descuento</span><span>-Bs. {descuento}</span></div>}
            <div style={{ display:'flex', justifyContent:'space-between', fontWeight:800, fontSize:20, borderTop:'2px solid #F1F5F9', paddingTop:10, marginTop:4 }}>
              <span>Total</span><span style={{ color:'#2563EB' }}>Bs. {totalFinal}</span>
            </div>
          </div>

          <button onClick={()=>setPantalla('datos')}
            style={{ width:'100%', padding:'16px', borderRadius:16, border:'none', background:'linear-gradient(135deg,#2563EB,#7C3AED)', color:'#fff', fontWeight:800, fontSize:16, cursor:'pointer', boxShadow:'0 8px 24px rgba(37,99,235,0.3)' }}>
            Continuar → Mis datos
          </button>
        </div>
      )}

      {pantalla==='datos' && (
        <div style={{ padding:'1rem', marginTop:'-1.5rem' }}>
          <div style={{ fontWeight:800, fontSize:20, marginBottom:4 }}>
            {form.tipoEntrega==='delivery'?'🚚 ¿A dónde te enviamos?':'🏪 Tus datos'}
          </div>
          <div style={{ fontSize:14, color:'#94A3B8', marginBottom:'1.5rem' }}>Total: <strong style={{ color:'#2563EB', fontSize:18 }}>Bs. {totalFinal}</strong></div>

          {[{key:'nombre',label:'Nombre completo',placeholder:'Ej: Juan Pérez',type:'text'},{key:'telefono',label:'Teléfono / WhatsApp',placeholder:'Ej: 71234567',type:'tel'}].map(f=>(
            <div key={f.key} style={{ marginBottom:'1rem' }}>
              <label style={{ fontSize:13, fontWeight:600, color:'#64748B', display:'block', marginBottom:6 }}>{f.label} <span style={{ color:'#EF4444' }}>*</span></label>
              <input value={form[f.key]} onChange={e=>setForm({...form,[f.key]:e.target.value})} placeholder={f.placeholder} type={f.type}
                style={{ width:'100%', padding:'14px', borderRadius:14, border:'1.5px solid #E2E8F0', fontSize:15, outline:'none' }}
                onFocus={e=>e.target.style.borderColor='#2563EB'} onBlur={e=>e.target.style.borderColor='#E2E8F0'} />
            </div>
          ))}

          {form.tipoEntrega==='delivery' && (
            <div style={{ marginBottom:'1rem' }}>
              <label style={{ fontSize:13, fontWeight:600, color:'#64748B', display:'block', marginBottom:6 }}>Dirección <span style={{ color:'#EF4444' }}>*</span></label>
              <input value={form.gps?'📍 Ubicación GPS capturada':form.direccion} onChange={e=>setForm({...form,direccion:e.target.value,gps:false})}
                placeholder="Ej: Av. Montes 345, piso 2"
                style={{ width:'100%', padding:'14px', borderRadius:14, border:'1.5px solid #E2E8F0', fontSize:15, outline:'none', marginBottom:8 }} />
              <button onClick={obtenerUbicacion} disabled={obteniendo}
                style={{ width:'100%', padding:'13px', borderRadius:14, border:`2px solid ${form.gps?'#10B981':'#2563EB'}`, background:form.gps?'#F0FDF4':'#fff', color:form.gps?'#059669':'#2563EB', fontWeight:700, fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                {obteniendo?'📡 Obteniendo...':form.gps?'✅ GPS capturado':'📍 Compartir ubicación GPS'}
              </button>
            </div>
          )}

          <div style={{ marginBottom:'1.25rem' }}>
            <label style={{ fontSize:13, fontWeight:600, color:'#64748B', display:'block', marginBottom:10 }}>💳 Método de pago</label>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:12 }}>
              {METODOS_PAGO.map(m=>(
                <button key={m.key} onClick={()=>{ setForm(p=>({...p,metodoPago:m.key})); setComprobante(null); setComprobantePreview(null); }}
                  style={{ padding:'12px 8px', borderRadius:14, border:`2px solid ${form.metodoPago===m.key?'#2563EB':'#E2E8F0'}`, background:form.metodoPago===m.key?'#EFF6FF':'#fff', cursor:'pointer', textAlign:'center' }}>
                  <div style={{ fontSize:24, marginBottom:4 }}>{m.icon}</div>
                  <div style={{ fontWeight:700, fontSize:12, color:form.metodoPago===m.key?'#2563EB':'#1E293B' }}>{m.label}</div>
                  <div style={{ fontSize:10, color:'#94A3B8', marginTop:2 }}>{m.sub}</div>
                </button>
              ))}
            </div>

            {form.metodoPago==='qr' && negocio.qr_url && (
              <div style={{ background:'#F0F9FF', borderRadius:14, padding:'1rem', marginBottom:12, textAlign:'center' }}>
                <div style={{ fontSize:14, fontWeight:700, color:'#0369A1', marginBottom:10 }}>📱 Escanea y paga Bs. {totalFinal}</div>
                <img src={negocio.qr_url} alt="QR de pago" style={{ width:180, height:180, objectFit:'contain', borderRadius:12, border:'2px solid #BAE6FD', margin:'0 auto', display:'block' }} />
              </div>
            )}
            {form.metodoPago==='qr' && !negocio.qr_url && (
              <div style={{ background:'#FEF3C7', borderRadius:10, padding:'10px 12px', fontSize:13, color:'#92400E', marginBottom:12 }}>
                ⚠️ El negocio aún no configuró su QR. Elige otro método.
              </div>
            )}
            {form.metodoPago==='transferencia' && negocio.info_transferencia && (
              <div style={{ background:'#F0F9FF', borderRadius:14, padding:'1rem', marginBottom:12 }}>
                <div style={{ fontSize:13, fontWeight:700, color:'#0369A1', marginBottom:6 }}>🏦 Transfiere a:</div>
                <pre style={{ fontSize:14, color:'#1E293B', whiteSpace:'pre-wrap', fontFamily:'inherit', margin:0, lineHeight:1.6 }}>{negocio.info_transferencia}</pre>
                <div style={{ fontSize:13, color:'#0369A1', fontWeight:600, marginTop:8 }}>Monto: Bs. {totalFinal}</div>
              </div>
            )}

            {necesitaComprobante && (
              <div style={{ background:'#fff', borderRadius:14, padding:'1rem', border:'2px dashed #2563EB' }}>
                <div style={{ fontSize:14, fontWeight:700, color:'#1E293B', marginBottom:6 }}>
                  📎 Sube tu comprobante de pago <span style={{ color:'#EF4444' }}>*</span>
                </div>
                <div style={{ fontSize:13, color:'#64748B', marginBottom:12 }}>Toma una foto de tu comprobante y súbela aquí.</div>
                {comprobantePreview ? (
                  <div style={{ textAlign:'center' }}>
                    <img src={comprobantePreview} alt="comprobante" style={{ maxWidth:'100%', maxHeight:200, borderRadius:10, objectFit:'contain', marginBottom:10 }} />
                    <button onClick={()=>{ setComprobante(null); setComprobantePreview(null); }}
                      style={{ display:'block', margin:'0 auto', padding:'6px 16px', borderRadius:8, border:'1px solid #FCA5A5', background:'#FEF2F2', color:'#DC2626', cursor:'pointer', fontSize:12, fontWeight:600 }}>
                      ✕ Quitar y subir otro
                    </button>
                  </div>
                ) : (
                  <label style={{ display:'block', padding:'14px', borderRadius:12, background:'#EFF6FF', textAlign:'center', cursor:'pointer', fontSize:14, fontWeight:600, color:'#2563EB' }}>
                    📷 Toca para subir comprobante
                    <input type="file" accept="image/*" onChange={seleccionarComprobante} style={{ display:'none' }} />
                  </label>
                )}
              </div>
            )}
          </div>

          <div style={{ marginBottom:'1.5rem' }}>
            <label style={{ fontSize:13, fontWeight:600, color:'#64748B', display:'block', marginBottom:6 }}>Nota (opcional)</label>
            <textarea value={form.nota} onChange={e=>setForm({...form,nota:e.target.value})}
              placeholder="Ej: Sin cebolla, tocar timbre..." rows={2}
              style={{ width:'100%', padding:'14px', borderRadius:14, border:'1.5px solid #E2E8F0', fontSize:14, outline:'none', resize:'none' }} />
          </div>

          {error && <div style={{ background:'#FEF2F2', color:'#DC2626', padding:'12px 14px', borderRadius:12, fontSize:14, marginBottom:'1rem', fontWeight:500 }}>⚠️ {error}</div>}

          <button onClick={confirmarPedido} disabled={enviando}
            style={{ width:'100%', padding:'17px', borderRadius:16, border:'none', background:enviando?'#93C5FD':'linear-gradient(135deg,#2563EB,#7C3AED)', color:'#fff', fontWeight:800, fontSize:16, cursor:enviando?'not-allowed':'pointer', boxShadow:enviando?'none':'0 8px 24px rgba(37,99,235,0.35)' }}>
            {enviando ? (subiendoComprobante ? '📤 Subiendo comprobante...' : '⏳ Enviando pedido...') : `✅ Confirmar pedido · Bs. ${totalFinal}`}
          </button>
          <div style={{ textAlign:'center', fontSize:12, color:'#94A3B8', marginTop:'1rem' }}>🔒 Tu pedido es seguro</div>
          <div style={{ textAlign:'center', fontSize:11, color:'#94A3B8', marginTop:8 }}>
            Creado por ALVARO R. MERLOS VALLEJOS · AX/CAPITALBOLIVIA
          </div>
        </div>
      )}
    </div>
  );
}
