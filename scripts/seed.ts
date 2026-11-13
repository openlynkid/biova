// Dev-only demo data. Run with: bun run db:seed (after db:migrate).
// Idempotent: re-running replaces the demo creator's links, products and page.
import { db, schema } from "@biova/database";
import { createServices, type BiovaServices } from "@biova/core";
import { socialLinksManifest } from "@biova/plugin-social-links/manifest";

const DEMO = {
  userId: "demo-user-0000000000000000",
  slug: "demo",
  displayName: "Demo Creator",
  bio: "Semua link pentingku ada di sini. Dibuat dengan Biova.",
};

const LINKS = [
  { title: "Website", url: "https://example.com", description: "Portfolio dan tulisan", icon: "🌐" },
  { title: "YouTube", url: "https://youtube.com/@example", description: "Video terbaru", icon: "▶" },
  { title: "Instagram", url: "https://instagram.com/example", description: "Foto harian", icon: "◉" },
  { title: "Toko Digital", url: "https://example.com/shop", description: "Produk dan preset", icon: "◫" },
];

const PRODUCTS = [
  {
    title: "Preset Lightroom Moody",
    slug: "preset-moody",
    priceIdr: 49_000,
    description: "10 preset siap pakai untuk foto sehari-hari.",
    asset: { fileName: "preset-moody.txt", contentType: "text/plain", body: "Preset Lightroom Moody — file demo Biova.\n" },
  },
  {
    title: "E-book Panduan Konten",
    slug: "ebook-konten",
    priceIdr: 89_000,
    description: "PDF 60 halaman tentang strategi konten.",
    asset: { fileName: "ebook-konten.txt", contentType: "text/plain", body: "E-book Panduan Konten — file demo Biova.\n" },
  },
];

// The seed uses the same manifest the web allowlist registers, so the demo page
// exercises the real install → enable → block flow rather than a shortcut.
const services: BiovaServices = createServices(db, {
  pluginCatalog: {
    get: (id) => (id === socialLinksManifest.id ? socialLinksManifest : undefined),
    list: () => [socialLinksManifest],
  },
});

async function ensureDemoUser() {
  await db
    .insert(schema.user)
    .values({
      id: DEMO.userId,
      name: DEMO.displayName,
      email: "demo@biova.test",
      emailVerified: true,
    })
    .onConflictDoNothing();
}

async function main() {
  await ensureDemoUser();

  let creator = await services.creators.getByUserId(DEMO.userId);
  if (!creator) {
    const created = await services.creators.getOrCreate({
      userId: DEMO.userId,
      slug: DEMO.slug,
      displayName: DEMO.displayName,
    });
    if (!created.ok) throw new Error(`failed to create creator: ${created.error}`);
    creator = created.value;
  }

  await services.pages.ensurePage(creator.id);
  await services.creators.updateProfile({ creatorId: creator.id, bio: DEMO.bio });

  const existing = await services.links.list(creator.id);
  for (const link of existing) await services.links.remove(creator.id, link.id);
  for (const link of LINKS) {
    const result = await services.links.create({ creatorId: creator.id, ...link });
    if (!result.ok) throw new Error(`failed to create link: ${result.error}`);
  }

  const existingProducts = await services.products.list(creator.id);
  for (const product of existingProducts) await services.products.remove(creator.id, product.id);
  for (const product of PRODUCTS) {
    const { asset, ...fields } = product;
    const result = await services.products.create({ creatorId: creator.id, ...fields });
    if (!result.ok) throw new Error(`failed to create product: ${result.error}`);
    // Products start as drafts; the demo page should show a live catalog.
    const live = await services.products.setStatus(creator.id, result.value.id, "published");
    if (!live.ok) throw new Error(`failed to publish product: ${live.error}`);

    // Attach the deliverable so a paid order has something to hand the buyer.
    const uploaded = await services.assets.add({
      creatorId: creator.id,
      productId: result.value.id,
      fileName: asset.fileName,
      contentType: asset.contentType,
      data: new TextEncoder().encode(asset.body),
    });
    if (!uploaded.ok) throw new Error(`failed to attach asset: ${uploaded.error}`);
  }

  const page = await services.pages.ensurePage(creator.id);
  const installed = await services.plugins.install(creator.id, socialLinksManifest.id);
  if (!installed.ok) throw new Error(`failed to install plugin: ${installed.error}`);
  const enabled = await services.plugins.setEnabled(creator.id, socialLinksManifest.id, true);
  if (!enabled.ok) throw new Error(`failed to enable plugin: ${enabled.error}`);
  for (const block of await services.plugins.listBlocks(creator.id, page.id).then((result) => (result.ok ? result.value : []))) {
    await services.plugins.removeBlock(creator.id, block.id);
  }
  const block = await services.plugins.addBlock({
    creatorId: creator.id,
    pageId: page.id,
    pluginId: socialLinksManifest.id,
    blockType: "social-links",
    config: { links: [{ label: "Newsletter", url: "https://example.com/newsletter" }] },
  });
  if (!block.ok) throw new Error(`failed to add block: ${block.error}`);

  const published = await services.pages.setStatus(creator.id, "published");
  if (!published.ok) throw new Error(`failed to publish page: ${published.error}`);

  console.log(`Seeded demo creator "${DEMO.slug}" with ${LINKS.length} links, ${PRODUCTS.length} products (published, with files) and an enabled ${socialLinksManifest.id} block.`);
}

await main();
process.exit(0);
