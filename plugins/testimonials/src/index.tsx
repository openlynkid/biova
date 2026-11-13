import type { BiovaPlugin, PageBlockProps } from "@biova/plugin-sdk";
import { testimonialsManifest } from "./manifest";

type Testimonial = { quote: string; author: string };

function TestimonialsBlock({ config }: PageBlockProps<{ testimonials: Testimonial[] }>) {
  return (
    <div className="testimonials-block">
      {config.testimonials.map((item) => (
        <figure key={`${item.author}-${item.quote}`} className="testimonial">
          <blockquote>{item.quote}</blockquote>
          <figcaption>{item.author}</figcaption>
        </figure>
      ))}
    </div>
  );
}

export const testimonialsPlugin: BiovaPlugin = {
  manifest: testimonialsManifest,
  pageBlocks: [
    {
      type: "testimonials",
      title: "Testimonials",
      description: "A set of quotes with attribution.",
      component: TestimonialsBlock,
      validateConfig(value) {
        if (!value || typeof value !== "object" || !Array.isArray((value as { testimonials?: unknown }).testimonials)) {
          throw new Error("Testimonials config must contain a testimonials array");
        }
        return value as { testimonials: Testimonial[] };
      },
    },
  ],
};
