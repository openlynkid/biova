# Biova — Product Requirements Document (PRD)

- **Versi:** 1.0
- **Tanggal:** 12 November 2026
- **Status:** Product Definition
- **Nama sebelumnya:** Openlynk
- **Nama produk:** Biova
- **Kategori:** Link-in-Bio & Creator Commerce SaaS

---

## 1. Product Overview

### 1.1 Product Vision

Biova adalah platform yang membantu kreator, freelancer, influencer, educator, dan digital entrepreneur membangun halaman profil digital sekaligus menjual produk dan layanan mereka dari satu tempat.

Biova menggabungkan fungsi link-in-bio, digital storefront, dan creator commerce dalam satu platform.

Pengguna dapat membuat halaman personal, menampilkan tautan, mempublikasikan produk digital, menerima pembayaran, serta mengelola pesanan melalui satu dashboard.

### 1.2 Product Positioning

Positioning statement:

> Biova is an all-in-one bio page and creator commerce platform that turns a creator's online presence into a business.

Biova bukan sekadar kumpulan tautan. Biova adalah mini-platform bisnis milik setiap kreator.

### 1.3 Core Value Proposition

- **One link:** Satu halaman untuk seluruh identitas dan aktivitas online.
- **One storefront:** Tautan, produk digital, dan penawaran dalam satu halaman.
- **One checkout:** Pembeli dapat melakukan transaksi melalui checkout terintegrasi.
- **One dashboard:** Kreator mengelola konten, produk, pesanan, dan performa dari satu tempat.

---

## 2. Target Market

Biova menggunakan pendekatan all-segment sejak peluncuran.

| Segmen | Kebutuhan utama |
|---|---|
| Content creators | Profil, tautan sosial, monetisasi |
| Influencers | Media kit, kolaborasi, produk |
| Educators | E-book, course, materi digital |
| Freelancers | Portfolio, layanan, lead generation |
| Digital entrepreneurs | Storefront dan penjualan produk |
| Small businesses | Profil bisnis dan katalog penawaran |
| Communities | Pusat informasi dan tautan komunitas |

Geografi:

- **Primary market:** Indonesia.
- **Expansion market:** Global.
- **Bahasa awal:** Indonesia dan Inggris.
- **Mata uang awal:** IDR, dengan fondasi multi-currency.

---

## 3. Product Goals

### Business Goals

1. Menyediakan platform link-in-bio dengan kemampuan monetisasi.
2. Menurunkan hambatan kreator dalam memulai bisnis digital.
3. Membangun sumber pendapatan melalui biaya transaksi dan paket berlangganan.
4. Mengembangkan ekosistem plugin dan integrasi pihak ketiga.
5. Menyiapkan arsitektur yang mampu berkembang tanpa harus membangun ulang fondasi.

### User Goals

1. Membuat halaman profil tanpa kemampuan coding.
2. Mengelola semua tautan dari satu dashboard.
3. Menampilkan dan menjual produk digital.
4. Menerima pembayaran secara praktis.
5. Mengakses informasi pesanan dan pendapatan.
6. Mengetahui performa halaman dan tautan.

### Non-Goals

Untuk MVP, Biova bukan:

- Marketplace umum yang mempertemukan banyak penjual dan pembeli.
- Platform social media.
- Website builder general-purpose.
- Platform penyimpanan dan distribusi file tanpa batas.
- Sistem SaaS white-label enterprise.

---

## 4. Product Scope

### 4.1 Public Creator Page

Setiap kreator memiliki halaman publik dengan URL unik.

Contoh: `biova.id/username`

Fitur:

- Creator profile.
- Avatar dan cover.
- Display name dan bio.
- Social links.
- Custom link buttons.
- Product showcase.
- Theme dan appearance customization.
- Responsive mobile-first layout.
- SEO metadata.
- Public page status.

### 4.2 Link Management

Fitur:

- Create, edit, delete links.
- Reorder links.
- Enable/disable links.
- Link title dan destination URL.
- Link thumbnail/icon.
- Click tracking.
- Basic click analytics.

### 4.3 Digital Product Management

Fitur:

- Create digital product.
- Product title dan description.
- Product thumbnail.
- Pricing dalam IDR.
- Upload digital assets.
- Publish/unpublish.
- Product visibility.
- Product catalog pada public page.

Jenis produk awal:

- E-book.
- PDF dan dokumen.
- Template.
- Digital assets.
- File unduhan lainnya.

### 4.4 Integrated Checkout

Pembeli dapat membeli produk langsung melalui Biova.

Fitur:

- Checkout page.
- Buyer information.
- Order creation.
- Payment gateway integration.
- Payment status.
- Order confirmation.
- Transaction history.

Payment provider awal: **Midtrans**.

Metode pembayaran mengikuti dukungan provider, seperti QRIS, e-wallet, virtual account, dan kartu pembayaran.

### 4.5 Digital Delivery

Setelah pembayaran terverifikasi:

- Sistem mengaktifkan entitlement pembeli.
- Pembeli memperoleh halaman akses pesanan.
- File dapat diunduh secara aman.
- Link distribusi file tidak boleh terekspos melalui halaman publik.
- Akses dan masa berlaku dapat dikelola berdasarkan kebijakan produk.

### 4.6 Creator Dashboard

Dashboard menjadi pusat pengelolaan akun.

Modul:

- Overview.
- Page editor.
- Links.
- Products.
- Orders.
- Analytics.
- Settings.

### 4.7 Analytics

MVP analytics:

- Total page views.
- Unique visitors jika dapat dihitung secara andal.
- Link clicks.
- Click-through rate.
- Product views.
- Orders.
- Revenue.

Analytics harus membedakan event mentah dari metrik agregat dan mencegah penghitungan ganda yang tidak disengaja.

---

## 5. MVP Requirements

### P0 — Essential

- User registration dan authentication.
- Creator onboarding.
- Satu creator memiliki satu public page.
- Unique username/slug.
- Public creator profile.
- Link CRUD dan sorting.
- Basic theme customization.
- Digital product CRUD.
- Secure asset upload.
- Integrated checkout.
- Payment webhook verification.
- Order management.
- Secure digital delivery.
- Creator dashboard.
- Basic analytics.
- Server-side authorization.
- Creator data isolation.

### P1 — Important

- Advanced themes.
- Custom SEO settings.
- Discount codes.
- Product variants.
- More analytics breakdowns.
- Custom domain support.
- Multiple payment methods.
- Email notifications.
- Creator branding customization.

### P2 — Expansion

- Plugin marketplace.
- Third-party integrations.
- Advanced page blocks.
- Membership/subscription products.
- Affiliate capabilities.
- Team access.
- Multi-page creator accounts.
- International payment providers.
- Multi-currency settlement.

---

## 6. User Roles

| Role | Permissions |
|---|---|
| Visitor | View public page and products |
| Buyer | Checkout and access purchased products |
| Creator | Manage own page, links, products, orders |
| Admin | Platform operations and moderation |
| Plugin | Access only approved capabilities and permissions |

Creator hanya boleh mengakses data yang menjadi miliknya. Admin memiliki akses berdasarkan kebijakan operasional dan audit.

---

## 7. Core User Journeys

### Journey A — Creator Onboarding

1. User membuka Biova.
2. User membuat akun.
3. User memilih username.
4. User melengkapi profil.
5. User menambahkan tautan.
6. User memilih tampilan halaman.
7. User mempublikasikan halaman.
8. Halaman tersedia melalui URL publik.

### Journey B — Publish Product

1. Creator membuka dashboard.
2. Creator membuat produk digital.
3. Creator mengisi informasi produk.
4. Creator mengunggah file.
5. Creator menentukan harga.
6. Creator mempublikasikan produk.
7. Produk tampil di halaman publik.

### Journey C — Buyer Checkout

1. Visitor membuka halaman kreator.
2. Visitor memilih produk.
3. Visitor mengisi informasi pembelian.
4. Sistem membuat order.
5. Buyer menyelesaikan pembayaran.
6. Sistem memverifikasi webhook pembayaran.
7. Order berubah menjadi paid.
8. Buyer memperoleh akses unduhan.

### Journey D — Creator Analytics

1. Creator membuka dashboard.
2. Sistem mengambil metrik halaman dan transaksi.
3. Creator melihat performa tautan.
4. Creator melihat performa produk dan pendapatan.

---

## 8. Technical Architecture

Biova menggunakan arsitektur **Bun-native Modular Monolith dengan Hybrid Plugin System**.

### Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Bun |
| Package manager | Bun |
| Monorepo | Bun Workspaces |
| Build orchestration | Turborepo |
| Web framework | TanStack Start |
| UI | React |
| HTTP API | ElysiaJS |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Database | PostgreSQL |
| ORM | Drizzle ORM |
| Database driver | postgres.js |
| Validation | Zod |
| Payment | Midtrans |
| Authentication | Better Auth — integrasi setelah validasi adapter dan session policy |

### Architecture Principles

1. Modular monolith sebagai fondasi awal.
2. Domain logic tidak bergantung pada framework HTTP atau UI.
3. Web dan API menggunakan domain services yang sama.
4. Database access hanya melalui domain/repository yang berwenang.
5. Setiap domain memiliki public interface.
6. Hindari circular dependencies.
7. Semua operasi sensitif harus diverifikasi di server.

### Proposed Monorepo Structure

```
biova/
├── apps/
│   ├── web/
│   └── api/
├── packages/
│   ├── database/
│   ├── shared/
│   ├── config-ts/
│   ├── plugin-sdk/
│   ├── plugin-registry/
│   ├── auth/
│   ├── creator/
│   ├── page/
│   ├── links/
│   ├── products/
│   ├── orders/
│   ├── payments/
│   ├── analytics/
│   └── media/
├── plugins/
│   └── social-links/
├── docs/
│   └── adr/
└── turbo.json
```

### Domain Boundaries

- **Creator:** identitas dan profil kreator.
- **Page:** halaman publik, tema, dan blok konten.
- **Links:** pengelolaan tautan dan click tracking.
- **Products:** katalog dan aset digital.
- **Orders:** order lifecycle dan buyer entitlement.
- **Payments:** gateway adapter, webhook, refund, reconciliation.
- **Analytics:** event collection dan agregasi.
- **Media:** upload, storage, dan secure delivery.

---

## 9. Hybrid Plugin System

Plugin merupakan kemampuan diferensiasi Biova.

### Build-time

- Plugin first-party yang disetujui dimasukkan melalui allowlist.
- Plugin SDK menjadi kontrak publik.
- Plugin registry memuat manifest dan kemampuan plugin.

### Runtime

- Creator dapat mengaktifkan atau menonaktifkan plugin.
- Konfigurasi dan permission disimpan per creator.
- Registry memeriksa status aktivasi dan permission sebelum menjalankan kemampuan.

### Security

- Plugin UI tidak boleh mengakses database atau secret.
- Plugin tidak boleh melewati domain service.
- External marketplace plugin tidak boleh mengeksekusi arbitrary code di proses utama Bun.
- Plugin eksternal harus menggunakan sandbox atau isolated service.
- Permission harus eksplisit, minimum, dan dapat dicabut.

Contoh plugin:

- Social links.
- Contact form.
- Featured products.
- Testimonials.
- Newsletter signup.
- Custom content blocks.

---

## 10. Data Model — Initial Domains

Entitas awal yang diperlukan:

- user
- session
- creator
- creator_profile
- creator_page
- page_theme
- page_block
- link
- link_click_event
- digital_product
- product_asset
- commerce_order
- commerce_order_item
- payment_transaction
- payment_webhook_event
- product_entitlement
- page_view_event
- plugin
- plugin_installation
- plugin_setting

Semua relasi yang menyimpan data kreator harus mendukung isolasi berdasarkan creator ID. Status transaksi dan entitlement harus memiliki state transition yang tervalidasi.

---

## 11. Security & Reliability Requirements

- Server-side authentication dan authorization.
- Tenant/creator-level data isolation.
- Input validation dengan schema.
- CSRF/origin protection untuk operasi yang relevan.
- Rate limiting untuk endpoint sensitif.
- Secure file storage.
- Signed atau tokenized download access.
- Payment webhook signature verification.
- Webhook idempotency.
- Transactional order/payment state updates.
- Amount dan currency verification.
- Audit trail untuk operasi sensitif.
- Database migration dan backup strategy.
- Error logging dan observability.
- Security headers dan secure cookie configuration.

Tidak boleh ada akses file berbayar hanya berdasarkan URL publik atau status pembayaran dari client.

---

## 12. Monetization Model

Model monetisasi dirancang hybrid:

1. **Free plan:** Fitur dasar untuk adopsi.
2. **Paid subscription:** Fitur premium, customization, dan analytics lanjutan.
3. **Transaction fee:** Biaya platform pada transaksi sesuai kebijakan paket.
4. **Add-ons:** Fitur tambahan yang dapat diaktifkan melalui sistem plugin.

Rincian harga, besaran transaction fee, dan batas penggunaan belum ditetapkan. Keputusan ini memerlukan validasi bisnis dan unit economics.

Platform subscription billing harus dipisahkan dari transaksi produk kreator.

---

## 13. Success Metrics

### Activation

- Creator registration-to-publish conversion.
- Median time to first published page.
- Percentage of creators adding at least one link.

### Engagement

- Active creators.
- Page views per creator.
- Link clicks per page.
- Product views.

### Commerce

- Checkout conversion rate.
- Paid order count.
- Gross merchandise value (GMV).
- Payment success rate.
- Refund/dispute rate.

### Reliability

- API availability.
- Payment webhook processing success.
- Order fulfillment correctness.
- Failed download rate.
- Critical security incidents.

Target angka ditentukan setelah baseline penggunaan dan eksperimen MVP tersedia.

---

## 14. Product Roadmap

### Phase 1 — Foundation

- Brand and product identity.
- Monorepo architecture.
- Authentication foundation.
- Creator and page domains.
- Database schema.
- Public page rendering.

### Phase 2 — Core Link-in-Bio

- Creator onboarding.
- Page editor.
- Link management.
- Theme customization.
- Public page publishing.

### Phase 3 — Creator Commerce

- Product management.
- Asset storage.
- Checkout.
- Midtrans integration.
- Order management.
- Secure digital delivery.

### Phase 4 — Growth & Analytics

- Page and link analytics.
- Revenue dashboard.
- SEO enhancements.
- Notifications.
- Conversion improvements.

### Phase 5 — Plugin Ecosystem

- Plugin SDK.
- First-party plugins.
- Runtime activation.
- Permission management.
- External plugin isolation architecture.

---

## 15. Acceptance Criteria

MVP dapat dinyatakan memenuhi product requirements ketika:

1. Creator dapat mendaftar dan membuat satu halaman publik.
2. Creator dapat mengelola tautan dan tampilan halaman.
3. Visitor dapat membuka halaman publik tanpa autentikasi.
4. Creator dapat membuat dan mempublikasikan produk digital.
5. Buyer dapat menyelesaikan checkout.
6. Payment status hanya berubah berdasarkan verifikasi server.
7. Webhook dapat diproses secara idempotent.
8. Buyer yang telah membayar dapat mengakses file secara aman.
9. Creator hanya dapat mengakses data miliknya.
10. Creator dapat melihat metrik dasar halaman dan transaksi.
11. Build, typecheck, lint, dan automated tests berjalan melalui CI.

---

## 16. Open Decisions

Hal berikut belum dianggap final:

- Domain resmi Biova.
- Final visual identity dan design system.
- Free vs paid feature limits.
- Besaran transaction fee.
- Paket berlangganan dan pricing.
- Kebijakan refund.
- Batas ukuran dan jenis file.
- Storage provider dan deployment provider.
- Custom domain pada MVP atau fase berikutnya.
- Detail multi-currency dan ekspansi pembayaran global.

---

## 17. Product Definition Summary

Biova adalah platform link-in-bio dan creator commerce yang memungkinkan kreator mengubah halaman profil menjadi storefront digital.

Prinsip produk:

- One creator, one page untuk MVP.
- All segments sejak peluncuran.
- Indonesia-first, global-ready.
- Integrated checkout.
- Digital product delivery.
- Modular monolith.
- Bun-native architecture.
- Hybrid plugin execution.
- Security-first commerce infrastructure.

**Product north star:** Membantu setiap kreator mengubah satu halaman bio menjadi pusat identitas, distribusi, dan monetisasi digital.
