"use client";

import Link from "next/link";

export default function GuidePage() {
  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "20px 0" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, color: "var(--text)", margin: "0 0 8px", textAlign: "center" }}>❓ إزاي أستخدم النظام؟</h1>
      <p style={{ fontSize: 14, color: "var(--muted)", textAlign: "center", marginBottom: 32 }}>دليل سريع ومباشر لاستخدام نظام ABOMAZEN</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Step 1 */}
        <div style={{ padding: "24px 28px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", gap: 20, alignItems: "flex-start" }}>
          <div style={{ width: 50, height: 50, borderRadius: 14, background: "rgba(245,158,11,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 900, color: "#f59e0b", flexShrink: 0 }}>1</div>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", margin: "0 0 8px" }}>🏘️ سجّل العقار الجديد</h3>
            <p style={{ fontSize: 14, color: "var(--muted)", margin: 0, lineHeight: 1.8 }}>
              ادخل على <strong style={{ color: "var(--text)" }}>العقارات</strong> من القائمة الجانبية، واضغط <strong style={{ color: "#f59e0b" }}>"+ إضافة عقار جديد"</strong>. اكتب اسم المالك، نوع العقار (شقة، فيلا...)، والموقع. اختر هل العقار للإيجار أو البيع. اضغط حفظ.
            </p>
            <Link href="/office/abomazen/properties" style={{ display: "inline-block", marginTop: 8, padding: "6px 14px", borderRadius: 8, background: "#f59e0b", color: "#fff", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>→ روح العقارات</Link>
          </div>
        </div>

        {/* Step 2 */}
        <div style={{ padding: "24px 28px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", gap: 20, alignItems: "flex-start" }}>
          <div style={{ width: 50, height: 50, borderRadius: 14, background: "rgba(245,158,11,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 900, color: "#f59e0b", flexShrink: 0 }}>2</div>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", margin: "0 0 8px" }}>📝 سجّل الصفقة</h3>
            <p style={{ fontSize: 14, color: "var(--muted)", margin: 0, lineHeight: 1.8 }}>
              اضغط <strong style={{ color: "#f59e0b" }}>"تسجيل صفقة جديدة"</strong> من لوحة التحكم. اختر نوع الصفقة (إيجار أو بيع). اختر العقار من القائمة أو سجّل صفقة سريعة بدون عقار. اكتب اسم الباحث والعمولة المقبوضة. المهم فقط: <strong style={{ color: "#f59e0b" }}>العمولة وصافي ABOMAZEN</strong>. اضغط حفظ.
            </p>
            <Link href="/office/abomazen/new-deal" style={{ display: "inline-block", marginTop: 8, padding: "6px 14px", borderRadius: 8, background: "#f59e0b", color: "#fff", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>→ سجّل صفقة جديدة</Link>
          </div>
        </div>

        {/* Step 3 */}
        <div style={{ padding: "24px 28px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", gap: 20, alignItems: "flex-start" }}>
          <div style={{ width: 50, height: 50, borderRadius: 14, background: "rgba(16,185,129,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 900, color: "#10b981", flexShrink: 0 }}>3</div>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", margin: "0 0 8px" }}>💰 شوف رصيدك</h3>
            <p style={{ fontSize: 14, color: "var(--muted)", margin: 0, lineHeight: 1.8 }}>
              ادخل على <strong style={{ color: "var(--text)" }}>لوحة التحكم</strong> وهتلاقي <strong style={{ color: "#f59e0b" }}>رصيدك المتاح</strong> في أعلى الصفحة. كل صفقة بتضيف صافيها تلقائيًا للرصيد. لو عايز تعرف تفاصيل أكتر، ادخل <strong style={{ color: "var(--text)" }}>الحسابات</strong>.
            </p>
            <Link href="/office/abomazen/dashboard" style={{ display: "inline-block", marginTop: 8, padding: "6px 14px", borderRadius: 8, background: "var(--surface-hover)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>→ لوحة التحكم</Link>
          </div>
        </div>

        {/* Step 4 */}
        <div style={{ padding: "24px 28px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", gap: 20, alignItems: "flex-start" }}>
          <div style={{ width: 50, height: 50, borderRadius: 14, background: "rgba(239,68,68,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 900, color: "#ef4444", flexShrink: 0 }}>4</div>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", margin: "0 0 8px" }}>🧾 سجّل المصروفات</h3>
            <p style={{ fontSize: 14, color: "var(--muted)", margin: 0, lineHeight: 1.8 }}>
              لو عندك مصروف (إيجار مكتب، رواتب، فواتير...)، ادخل <strong style={{ color: "var(--text)" }}>الحسابات</strong> → تبويب <strong style={{ color: "#ef4444" }}>المصروفات</strong>. اضغط "مصروف جديد" واكتب الوصف والتكلفة والمستلم. المصروفات بتتخصم من الرصيد تلقائيًا.
            </p>
            <Link href="/office/abomazen/finance" style={{ display: "inline-block", marginTop: 8, padding: "6px 14px", borderRadius: 8, background: "var(--surface-hover)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>→ الحسابات</Link>
          </div>
        </div>

        {/* Step 5 */}
        <div style={{ padding: "24px 28px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", gap: 20, alignItems: "flex-start" }}>
          <div style={{ width: 50, height: 50, borderRadius: 14, background: "rgba(59,130,246,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 900, color: "#3b82f6", flexShrink: 0 }}>5</div>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", margin: "0 0 8px" }}>📋 راجع كل صفقاتك</h3>
            <p style={{ fontSize: 14, color: "var(--muted)", margin: 0, lineHeight: 1.8 }}>
              ادخل على <strong style={{ color: "var(--text)" }}>كل الصفقات</strong> عشان تشوف كل الصفقات اللي سجلتها. تقدر تعدل أو تحذف أي صفقة. في اجمالي في آخر الجدول بينظرك المجموع الكلي.
            </p>
            <Link href="/office/abomazen/deals" style={{ display: "inline-block", marginTop: 8, padding: "6px 14px", borderRadius: 8, background: "var(--surface-hover)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>→ كل الصفقات</Link>
          </div>
        </div>
      </div>

      {/* Tip */}
      <div style={{ marginTop: 32, padding: "20px 24px", borderRadius: 14, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", textAlign: "center" }}>
        <div style={{ fontSize: 18, marginBottom: 8 }}>💡</div>
        <p style={{ fontSize: 14, color: "var(--text)", margin: 0, lineHeight: 1.8 }}>
          <strong>نصيحة:</strong> لو عندك أي سؤال أو مشكلة، تواصل مع الإدارة. النظام مصمم يكون بسيط ومباشر — كل عملية في صفحة واحدة بدون تعقيد.
        </p>
      </div>
    </div>
  );
}
