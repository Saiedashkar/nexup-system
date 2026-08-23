# Nexup Design System

## الهوية البصرية

استُخلصت من الصور المرجعية (Dashboard UI + AeuxGlobal) وأُدمجت مع هوية Nexup التجارية.

---

## 1. الألوان (Color Palette)

### الألوان الأساسية
| المتغير | الكود | الاستخدام |
|---------|-------|-----------|
| `--brand` | `#0d9488` | اللون الرئيسي (Teal 600) |
| `--brand-dark` | `#0f766e` | Hover / Teal 700 |
| `--brand-light` | `#14b8a6` | Teal 500 — أيقونات نشطة |
| `--brand-pale` | `#ccfbf1` | Teal 50 — خلفيات فرعية |

### Sidebar
| المتغير | الكود | الاستخدام |
|---------|-------|-----------|
| `--sidebar` | `#0f172a` | خلفية الشريط الجانبي (Slate 900) |
| `--sidebar-hover` | `#1e293b` | Hover في الشريط (Slate 800) |
| `--sidebar-text` | `#94a3b8` | نصوص الشريط (Slate 400) |
| `--sidebar-active` | `#0d9488` | العنصر النشط في الشريط |

### الخلفيات والأسطح
| المتغير | الكود | الاستخدام |
|---------|-------|-----------|
| `--paper` | `#f1f5f9` | الخلفية الرئيسية (Slate 100) |
| `--panel` | `#ffffff` | الكروت والأسطح (أبيض) |
| `--line` | `#e2e8f0` | الفواصل والحدود (Slate 200) |

### النصوص
| المتغير | الكود | الاستخدام |
|---------|-------|-----------|
| `--ink` | `#0f172a` | النص الرئيسي (Slate 900) |
| `--ink-secondary` | `#475569` | النص الثانوي (Slate 600) |
| `--muted` | `#94a3b8` | النصوص الثانوية الخفيفة (Slate 400) |

### حالات (Status Colors)
| المتغير | الكود | الاستخدام |
|---------|-------|-----------|
| `--success` | `#22c55e` | حالة ناججة / مكتملة |
| `--warning` | `#f59e0b` | حالة انتظار / تحذير |
| `--danger` | `#ef4444` | حالة خطأ / متعثر |
| `--info` | `#3b82f6` | معلومات / رابط |

### تصنيفات العملاء (Client Tiers)
| التصنيف | اللون | الخلفية |
|---------|-------|---------|
| VIP | `#8b5cf6` (Purple 500) | `#f5f3ff` (Purple 50) |
| LOYAL | `#0d9488` (Teal 600) | `#ccfbf1` (Teal 50) |
| NORMAL | `#64748b` (Slate 500) | `#f1f5f9` (Slate 100) |
| DELINQUENT | `#ef4444` (Red 500) | `#fef2f2` (Red 50) |

---

## 2. الخطوط (Typography)

### الخط الأساسي
```css
font-family: 'Inter', 'Segoe UI', Tahoma, Arial, sans-serif;
```
- **Inter** — الخط الرئيسي (يُحمّل من Google Fonts)
- **Segoe UI** — البديل المحلي لـ Windows
- **Tahoma** — البديل الأقدم

### أحجام الخطوط
| الطبقية | الحجم | الزيادة | الوزن |
|---------|-------|---------|-------|
| H1 | 1.875rem (30px) | 2.25rem | 800 |
| H2 | 1.5rem (24px) | 2rem | 700 |
| H3 | 1.25rem (20px) | 1.5rem | 700 |
| Body | 0.875rem (14px) | 1.25rem | 400 |
| Small | 0.75rem (12px) | 1rem | 500 |
| Label | 0.8125rem (13px) | 1rem | 600 |

---

## 3. الكروت (Cards)

### الكارت الأساسي
```css
.card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
}
```

### كارت الإحصائيات (Stat Card)
```css
.stat-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 20px;
  position: relative;
  overflow: hidden;
}
.stat-card::before {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  width: 4px;
  height: 100%;
  background: var(--brand);
  border-radius: 0 14px 14px 0;
}
```

---

## 4. الأزرار (Buttons)

### الزر الأساسي
```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 20px;
  border: none;
  border-radius: 10px;
  font-weight: 600;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-primary {
  background: var(--brand);
  color: white;
}
.btn-primary:hover {
  background: var(--brand-dark);
}

.btn-secondary {
  background: var(--paper);
  color: var(--ink);
  border: 1px solid var(--line);
}
.btn-secondary:hover {
  background: var(--line);
}
```

---

## 5. المسافات والـ Spacing

### المقياس (Base: 4px)
| القيمة | الحجم |
|--------|-------|
| xs | 4px |
| sm | 8px |
| md | 12px |
| lg | 16px |
| xl | 24px |
| 2xl | 32px |
| 3xl | 48px |

### الحد الأقصى للعرض
```css
.max-w {
  max-width: 1200px;
  margin: 0 auto;
}
```

---

## 6. الظلال (Shadows)

### الظلال المتدرجة
| الطبقة | القيمة | الاستخدام |
|--------|--------|-----------|
| shadow-sm | `0 1px 2px rgba(15,23,42,0.05)` | الكروت الطبيعية |
| shadow-md | `0 4px 6px -1px rgba(15,23,42,0.07)` | الكروت المرفوعة |
| shadow-lg | `0 10px 15px -3px rgba(15,23,42,0.08)` | القوائم المنسدلة |
| shadow-xl | `0 20px 25px -5px rgba(15,23,42,0.1)` | النوافذ المنبثقة |

---

## 7. الجداول (Tables)

```css
.table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
}
.table th {
  background: var(--paper);
  padding: 12px 16px;
  text-align: right;
  font-weight: 600;
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--muted);
  border-bottom: 1px solid var(--line);
}
.table td {
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
  font-size: 0.875rem;
}
.table tr:hover td {
  background: var(--paper);
}
```

---

## 8. الحقول (Form Fields)

```css
.input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
  font-size: 0.875rem;
  outline: none;
  transition: border-color 0.2s;
}
.input:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(13, 148, 136, 0.1);
}
.input-label {
  display: block;
  margin-bottom: 6px;
  font-weight: 600;
  font-size: 0.8125rem;
  color: var(--ink-secondary);
}
```

---

## 9. البادجات (Badges)

```css
.badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
}
.badge-vip { background: #f5f3ff; color: #7c3aed; }
.badge-loyal { background: #ccfbf1; color: #0d9488; }
.badge-normal { background: #f1f5f9; color: #64748b; }
.badge-delinquent { background: #fef2f2; color: #dc2626; }
.badge-completed { background: #dcfce7; color: #16a34a; }
.badge-in-progress { background: #dbeafe; color: #2563eb; }
.badge-waiting { background: #fef3c7; color: #d97706; }
.badge-paused { background: #f1f5f9; color: #64748b; }
```

---

## 10. الخطوط العريضة للتصميم (Design Principles)

1. **نظافة** — مسافات واسعة، عناصر واضحة، لا زحمة
2. **اتساق** — نفس الـ border-radius (10-16px) لكل مكان
3. **层次** — ظلال خفيفة لتمييز الطبقات
4. **RTL** — كل شيء من اليمين لليسار
5. **محترف** — ألوان محايدة مع لمسة Teal حيوية
