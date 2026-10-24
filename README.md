# ⚽ Fútbol 7 · Rotaciones

App web (PWA) para el móvil que controla el tiempo de juego de cada jugador en un partido de fútbol 7, avisa de cuándo hay que hacer los cambios y los propone teniendo en cuenta las posiciones de cada uno. El objetivo es que todos jueguen lo mismo.

No necesita servidor ni cuentas: los datos se guardan en el propio teléfono y funciona sin conexión.

## Qué hace

- **Plantilla**: jugadores con dorsal y las posiciones en las que pueden jugar **en orden de preferencia** (1ª, 2ª, 3ª…, sin límite; se reordenan con ▲ ▼): portero (POR), lateral izquierdo (LI), defensa central (DFC), lateral derecho (LD), centrocampista (MED) y delantero (DEL). En cada posición se indica **cómo la juega: Muy bien, Bien o Cumple** (por defecto, Muy bien). En la plantilla, las que juega *Bien* llevan una marca (·) y las que *Cumple*, dos (··).
- **Portero suplente**: si un jugador de campo también tiene marcada la posición de portero, en su ficha se puede activar *Portero suplente*. Así solo juega de portero cuando no hay otro portero en el partido (no viene el titular, o el titular se lesiona o se va durante el partido). Mientras haya un portero titular, juega solo de campo y la app no lo mete en la portería en los cambios. En la plantilla se ve como *POR sup.*
- **Convocatoria**: marcas quién puede ir. Si hay más disponibles que plazas (12 por defecto, configurable), entran primero los que **menos minutos** llevan en la temporada (y, a igualdad, los que menos partidos han jugado). Siempre intenta que haya un portero (antes el titular que el suplente). Se puede ajustar a mano. Si para alguna posición o **línea** (defensa, medio, ataque) del sistema hay pocos convocados, te avisa.
- **Sistema**: 1-3-2-1 (POR · LI, DFC, LD · 2 MED · DEL) o 1-2-3-1 (POR · 2 DFC · 3 MED · DEL). En el 1-2-3-1, el central izquierdo también lo puede cubrir un LI, y el derecho un LD.
- **Once inicial y plan de cambios**: la app propone el once y un plan para todo el partido, con los **minutos previstos** de cada jugador al final.
- **Durante el partido**:
  - Reloj por partes (2 × 25 min), con pausa y tiempo añadido.
  - Minutos de cada jugador en tiempo real.
  - Cuenta atrás hasta el próximo cambio. El **próximo cambio queda fijado** en cuanto se anuncia (minuto, quién entra, quién sale y en qué puesto) y el aviso será exactamente ese; solo se vuelve a calcular si haces un cambio a mano, deshaces o alguien deja de estar disponible. Cuando toca, aparece “¡Toca cambio!” con quién entra, quién sale y en qué puesto, y salta una **alarma que no para** (un **rugido de león** detrás de otro, o pitidos si lo eliges en *Ajustes → Sonido del aviso*; la pantalla parpadea y, si estás en otra pestaña, sale una barra para volver al partido) hasta que pulsas **Hacer cambios** (u **Omitir**).
  - **Cambio no previsto** (lesión, cansancio...): toca al jugador en el campo y la app te dice quién debe entrar (el del banquillo que encaja en ese puesto y menos ha jugado), con otras opciones ordenadas. Si marcas *Lesionado*, ya no vuelve a contar para el partido. Tras el cambio, se reorganizan todos los cambios siguientes.
  - También puedes tocar un jugador y después otro (del campo o del banquillo) para intercambiarlos.
  - Alguien que llega tarde o se va: márcalo como *No disponible* / *Disponible* en la tabla de minutos.
  - Marcador, **Deshacer**, y la pantalla se mantiene encendida.
- **Rival y fecha**: se ponen al preparar el partido (en los dos pasos de *Nuevo partido*). En la previa o durante el partido, toca el nombre del rival en el marcador para cambiarlo.
- **Estadísticas**: convocatorias, partidos jugados, minutos totales y media por jugador, e historial de partidos con **buscador por rival**. Al abrir un partido puedes corregir el rival y la fecha. En cada partido, el **registro de cambios**: configuración usada, once inicial y cada cambio con su minuto y puesto (avisa si alguien jugó fuera de su posición).
- **Compartir y copia de seguridad**: *Ajustes → Exportar / compartir* abre el menú de compartir del iPhone (WhatsApp, AirDrop, Correo, Guardar en Archivos…) con un archivo `.json` con la plantilla, los partidos y los ajustes. Quien lo recibe lo guarda (iPhone: app **Archivos**; Android: queda en **Descargas**) y, en su app, pulsa *Ajustes → Importar archivo*. Alternativa sin archivos: *Copiar como texto*, enviarlo en un mensaje y, en el otro móvil, copiar el mensaje y usar *Pegar texto*. Importar **sustituye** todos los datos de ese móvil.

### Cómo decide los cambios

- Orden de prioridades al decidir los cambios:
  1. **Que todos jueguen lo mismo.**
  2. **Tiempo mínimo seguido en el campo** (7 min por defecto) y **máximo seguido en el banquillo** (8 min por defecto), configurables en *Ajustes*. Si con una convocatoria no se pueden cumplir sin que unos jueguen bastante más que otros, la app los relaja lo justo para ese partido y lo dice en la previa. Los porteros que solo son porteros no cuentan.
  3. **Respetar las posiciones**: cada uno donde mejor juega. Manda el nivel (*Muy bien* antes que *Bien* y *Bien* antes que *Cumple*) y, entre posiciones del mismo nivel, el orden de su lista (si todas están en *Muy bien*, decide el orden). Una posición en *Cumple* se usa cuando hace falta, pero siempre antes que poner a alguien que no la tiene en su lista; después, alguien de la misma línea y, solo si no queda otra, de otra línea. La app reserva a los polivalentes para la línea que va más justa. La portería, siempre un portero, y quien solo es portero nunca juega de campo.
- En cada remesa busca la mejor combinación de jugadores y puestos (algoritmo húngaro). Para el plan completo, revisa remesa a remesa varias alternativas y se queda con la que deja los minutos finales más iguales. Procura no mover a quien ya está jugando. En pruebas con plantillas variadas, los jugadores de campo acaban con 0–1½ minutos de diferencia.
- En modo **Automático** puedes **fijar el minuto de la primera remesa** (por defecto, el 8). A partir de ahí, la app decide cuándo cambiar, y después de cada remesa vuelve a planificar con los minutos reales (por ejemplo, si un cambio se confirmó tarde). Deja al menos 3 minutos entre remesas y no propone cambios en los últimos 2½ minutos de cada parte. Si no fijas la primera remesa, elige también ese momento.
- Opción *“El portero solo cambia en el descanso”* (activada por defecto). Si hay dos porteros, se reparten las partes, y el que vaya a ser portero en la 2ª parte descansa más en la 1ª.
- O eliges tú **cada cuántos minutos** se hacen los cambios (de 2 a 20 min), al preparar el partido o en la previa, antes de empezar. Los cambios se hacen en esos minutos de cada parte, y también en el descanso. Con la opción *Ajustar algún cambio (±3 min)* (activada por defecto), la app puede adelantar o retrasar algún cambio hasta 3 minutos para que las cuentas cuadren y todos jueguen lo mismo; en la previa verás los minutos exactos.

## Instalarla en el iPhone

1. Publica la carpeta en cualquier hosting estático. Lo más sencillo es **GitHub Pages**: *Settings → Pages → Build and deployment → Source: Deploy from a branch*, elige la rama y la carpeta `/ (root)` y guarda. A los pocos minutos estará en `https://<usuario>.github.io/<repositorio>/`.
2. Abre esa dirección en **Safari** desde el iPhone.
3. Pulsa **Compartir → Añadir a pantalla de inicio**.

Se abre a pantalla completa como una app normal y funciona sin cobertura en el campo. Con conexión carga siempre la última versión; el número de versión aparece al final de *Ajustes*.

> Los datos se guardan solo en el teléfono donde se usa la app. De vez en cuando, haz *Ajustes → Exportar* para tener una copia.
> Deja la app abierta durante el partido (la pantalla no se apaga sola mientras está abierta). Si bloqueas el iPhone o cambias a otra app, iOS detiene la página y la alarma no puede sonar hasta que vuelvas. El iPhone solo deja sonar una página después de tocar la pantalla: si abres la app con el partido en marcha, sale un aviso amarillo para activar el sonido. Con **🔊 Probar sonido** puedes comprobarlo antes de empezar. Sube el volumen del iPhone (el de contenido, no el del timbre).

## Desarrollo

Es HTML, CSS y JavaScript sin dependencias ni compilación.

```bash
npx http-server .          # o cualquier servidor estático
node --test tests/*.test.mjs   # pruebas de la lógica de rotaciones
```

- `js/logic.js`: lógica pura (sistemas, asignación de puestos, plan de cambios, convocatoria).
- `js/app.js`: interfaz.
- `js/store.js`: guardado en el dispositivo.
- `sw.js` y `manifest.webmanifest`: uso sin conexión e instalación.
- `sounds/rugido.mp3`: sonido del aviso (rugido de león, «cartoon lion roar» de Dragon Studio).
