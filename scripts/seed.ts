// Dev-only demo data. Run with: bun run db:seed (after db:migrate).
// Idempotent: re-running replaces the demo creator's links and page.
import { db, schema } from "@biova/database";
import { createServices, type BiovaServices } from "@biova/core";

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

const services: BiovaServices = createServices(db);

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

  const published = await services.pages.setStatus(creator.id, "published");
  if (!published.ok) throw new Error(`failed to publish page: ${published.error}`);

  console.log(`Seeded demo creator "${DEMO.slug}" with ${LINKS.length} links (published).`);
}

await main();
process.exit(0);
