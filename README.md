# Meridian Imports — Shipping & Import Services Website

A fast, fully static, SEO-optimized website for an import/shipping company. Built with plain
HTML, CSS, and vanilla JavaScript — no build step, no dependencies. Host it anywhere (GitHub
Pages, Netlify, Vercel, S3, Apache, Nginx).

> **Meridian Imports** is a placeholder brand. Rename it and swap the domain before launch
> (see [Customizing](#customizing)).

## Features

- 12 pages: Home, Services, Tracking, Get a Quote, Pricing, About, Contact, FAQ, Blog, Privacy, Terms, and a custom 404.
- Responsive, mobile-first layout with an accessible navigation menu.
- Client-side shipment tracking demo and quote/contact forms with validation.
- Full technical SEO: unique titles & meta descriptions, canonical URLs, Open Graph + Twitter cards, JSON-LD structured data, `sitemap.xml`, `robots.txt`, and a web app manifest.
- Zero third-party runtime dependencies. Loads fast, scores well on Core Web Vitals.

## Project structure

```
Shipping-website/
├── index.html            # Home
├── services.html         # Services offered
├── tracking.html         # Track a shipment
├── quote.html            # Request a quote
├── pricing.html          # Pricing tiers
├── about.html            # Company / about us
├── contact.html          # Contact + form
├── faq.html              # Frequently asked questions
├── blog.html             # Blog index
├── privacy.html          # Privacy policy
├── terms.html            # Terms of service
├── 404.html              # Custom not-found page
├── css/
│   └── styles.css        # Single shared stylesheet
├── js/
│   └── main.js           # Nav, tracking demo, form validation
├── assets/
│   ├── favicon.svg       # Site icon
│   └── og-image.svg      # Social share image
├── robots.txt            # Crawler directives
├── sitemap.xml           # XML sitemap
├── site.webmanifest      # PWA manifest
└── README.md             # This file
```

## Running locally

It's static — just open `index.html`, or serve the folder to get clean routing:

```bash
# Python
python -m http.server 8000

# Node
npx serve .
```

Then visit http://localhost:8000.

## Deploying

- **GitHub Pages:** push to a repo, enable Pages on the `main` branch (root).
- **Netlify / Vercel:** drag-and-drop the folder or connect the repo. No build command; publish directory is the root.
- **Any web server:** upload the files to the web root.

## Customizing

Before going live, do a project-wide find & replace for these placeholders:

| Placeholder | Replace with |
|---|---|
| `Meridian Imports` | Your company name |
| `https://www.meridianimports.com` | Your real domain (used in canonical URLs, sitemap, OG tags) |
| `hello@meridianimports.com` | Your email |
| `+1 (555) 010-2040` | Your phone |
| Address in the footer / Contact page | Your address |

After changing the domain, update it in every page's `<link rel="canonical">`, the Open Graph
`og:url`/`og:image` tags, `sitemap.xml`, and `robots.txt`.

## SEO checklist (already done)

- [x] One `<h1>` per page, descriptive titles under ~60 chars
- [x] Meta descriptions under ~155 chars, unique per page
- [x] Canonical URLs on every page
- [x] Open Graph + Twitter Card tags
- [x] JSON-LD: `Organization`, `WebSite`, `BreadcrumbList`, `FAQPage`, `Service`
- [x] `sitemap.xml` + `robots.txt` referencing it
- [x] Semantic HTML5 landmarks (`header`, `nav`, `main`, `footer`)
- [x] Descriptive `alt` text and ARIA labels
- [x] Mobile-friendly viewport + responsive CSS

## To do after launch

- Replace the SVG placeholders in `assets/` with real branded PNG/JPG (1200×630 for `og-image`).
- Wire the quote/contact forms to a backend or form service (Formspree, Netlify Forms, etc.).
- Connect tracking to your real carrier/TMS API.
- Register the site with Google Search Console and submit the sitemap.

## License

Proprietary — for the Meridian Imports project. Replace with your own license as needed.
