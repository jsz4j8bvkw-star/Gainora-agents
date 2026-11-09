// Small recorded-shape fixtures shared by the tests. Not a test file itself.

/** A cut-down Fresha venue page: server-rendered Next.js with the venue in __NEXT_DATA__ and schema.org JSON-LD. */
export const FRESHA_PAGE = `<!DOCTYPE html><html><head><title>Skin Studio - Crewe | Fresha</title>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"HealthAndBeautyBusiness","name":"Skin Studio","aggregateRating":{"@type":"AggregateRating","ratingValue":4.9,"reviewCount":212},"hasOfferCatalog":{"@type":"OfferCatalog","itemListElement":[{"@type":"Offer","itemOffered":{"@type":"Service","name":"Lip Filler 1ml"},"price":"220","priceCurrency":"GBP"}]}}]}</script>
</head><body><div id="__next"><h1>Skin Studio</h1></div>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { data: { location: {
  id: 555, name: 'Skin Studio', rating: 4.9, reviewsCount: 212, serviceCount: 31, servicePriceRange: '£20 - £450', contactNumber: '+44 1270 000000',
  address: { line1: '12 Market Street', city: 'Crewe', formatted: '12 Market Street, Crewe, CW1 2EG' },
  employeeProfiles: [{ id: 1, firstName: 'Amy' }, { id: 2, firstName: 'Jo' }, { id: 3, firstName: 'Priya' }],
  services: [
    { id: 1, name: 'Injectables', items: [
      { id: 11, name: 'Lip Filler 1ml', caption: '45 mins', formattedRetailPrice: '£220', retailPrice: 220, priceType: 'fixed', variants: [] },
      { id: 12, name: 'Anti-Wrinkle Injections', caption: '30 mins', formattedRetailPrice: 'from £150', retailPrice: 150, priceType: 'from', variants: [
        { id: 121, name: '1 area', caption: '30 mins', formattedRetailPrice: '£150', retailPrice: 150 },
        { id: 122, name: '2 areas', caption: '30 mins', formattedRetailPrice: '£200', retailPrice: 200 },
        { id: 123, name: '3 areas', caption: '30 mins', formattedRetailPrice: '£240', retailPrice: 240 },
      ] },
      { id: 13, name: 'Consultation', caption: '15 mins', formattedRetailPrice: 'Free', retailPrice: 0, priceType: 'free', variants: [] },
    ] },
    { id: 2, name: 'Skin', items: [
      { id: 21, name: 'Profhilo (2 sessions)', caption: '30 mins', formattedRetailPrice: '£350', retailPrice: 350, priceType: 'fixed', variants: [] },
      { id: 22, name: 'Dermaplaning', caption: '45 mins', formattedRetailPrice: '£45', retailPrice: 45, priceType: 'fixed', variants: [{ id: 221, name: 'Dermaplaning', caption: '45 mins', formattedRetailPrice: '£45', retailPrice: 45 }] },
    ] },
  ],
} } } }, page: '/a/[slug]' })}</script></body></html>`;

