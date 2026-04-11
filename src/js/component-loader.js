/**
 * ═══════════════════════════════════════════════════════════════════════════
 * component-loader.js — Professional Component Loading System
 * 
 * HTML komponentlarni fayllardan o'qib, DOM ga joylaydi.
 * Electron muhitida Node.js `fs` moduli orqali ishlaydi.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const nodePath = require('path');

const ComponentLoader = {
  basePath: nodePath.join(__dirname, 'src', 'components'),

  /**
   * Bitta komponent faylni o'qib, container elementga inject qiladi.
   * @param {string} name — fayl nomi (masalan: 'titlebar' → titlebar.html)
   * @param {string|HTMLElement} container — target element yoki uning ID'si
   * @param {'append'|'prepend'|'replace'} mode — qo'shish usuli
   */
  load(name, container, mode = 'append') {
    const filePath = nodePath.join(this.basePath, `${name}.html`);
    
    try {
      const html = fs.readFileSync(filePath, 'utf-8');
      const target = typeof container === 'string' 
        ? document.getElementById(container) 
        : container;
      
      if (!target) {
        console.error(`[Components] Container topilmadi: ${container}`);
        return false;
      }

      switch (mode) {
        case 'prepend':
          target.insertAdjacentHTML('afterbegin', html);
          break;
        case 'replace':
          target.innerHTML = html;
          break;
        case 'append':
        default:
          target.insertAdjacentHTML('beforeend', html);
          break;
      }

      console.log(`[Components] ✅ ${name}.html yuklandi`);
      return true;
    } catch (err) {
      console.error(`[Components] ❌ ${name}.html yuklanmadi:`, err.message);
      return false;
    }
  },

  /**
   * Bir nechta komponentni ketma-ket yuklash
   * @param {Array<{name: string, container: string|HTMLElement, mode?: string}>} components
   */
  loadAll(components) {
    let loaded = 0;
    const total = components.length;
    
    components.forEach(({ name, container, mode }) => {
      if (this.load(name, container, mode || 'append')) {
        loaded++;
      }
    });

    console.log(`[Components] Jami: ${loaded}/${total} komponent yuklandi`);
    return loaded === total;
  }
};

window.ComponentLoader = ComponentLoader;
