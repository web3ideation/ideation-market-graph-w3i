# ideation-market-graph-w3i

Subgraph for the **IdeationMarket Diamond** (EIP-2535). It indexes the marketplace's listing lifecycle, payment distributions, per-listing buyer whitelists, global collection curation, and currency allowlists for comprehensive marketplace data.

- **Network:** Sepolia (chainId `11155111`)
- **Diamond (proxy):** `0x8cE90712463c87a6d62941D67C3507D090Ea9d79`
- **Data sources:** `IdeationMarketFacet` (listings + payments), `BuyerWhitelistFacet` (per-listing whitelist), `CollectionWhitelistFacet` (global curation), `CurrencyWhitelistFacet` (payment tokens)
- **Entities:** `Listing`, `Payment`, `WhitelistedBuyer`, `WhitelistedCollection`, `AllowedCurrency`

---

## What's indexed

### `Listing` (one row per `listingId`)
- `listingId`, `tokenAddress`, `tokenId`, `tokenStandard`
- `erc1155QuantityListed` (snapshot at create)
- `remainingQuantity` (decrements on each purchase; `null` for ERC-721)
- `priceTotal` (remaining total; for ERC-721 becomes `0` after sale)
- `unitPrice` (set only if partial buys are enabled for ERC-1155)
- `currency` (payment token: ETH = `0x0000...`, or ERC-20 address)
- Flags: `buyerWhitelistEnabled`, `partialBuyEnabled`
- `listingType` (`PURE_ETH` | `SWAP_AND_ETH` | `PURE_SWAP`)
- `feeRate` (snapshot at create/update; denominator `100_000`)
- Swap targets: `desiredTokenAddress`, `desiredTokenId`, `desiredErc1155Quantity`
- `seller`, `status` (`LISTED` | `PARTIALLY_FILLED` | `SOLD_OUT` | `CANCELED` | `INVALIDATED`), `active`
- `createdAt`

### `Payment` (one row per payment event)
- `listingId` (foreign key), `recipient`, `currency`, `amount`
- `paymentType` (`INNOVATION_FEE` | `ROYALTY` | `SELLER_PROCEEDS`)
- `timestamp`, `txHash`, `blockNumber`

### `WhitelistedBuyer` (presence = whitelisted)
- `listingId`, `buyer`, `createdAt`

### `WhitelistedCollection` (global NFT curation)
- `collection` (NFT contract address)
- `isWhitelisted` (boolean flag - never deleted, only toggled)
- `addedAt`, `lastUpdatedAt`

### `AllowedCurrency` (global payment token allowlist)
- `currency` (ERC-20 address or `0x0000...` for ETH)
- `isAllowed` (boolean flag - never deleted, only toggled)
- `addedAt`, `lastUpdatedAt`

> **Design notes:**
> - Buyer whitelist entries are **deleted** on revoke (no boolean flag).
> - Collection/Currency entities use **boolean flags** (never deleted) to maintain audit trail.

---

## Getting started

Tooling is pinned to a Graph CLI version that works with Node 20.10.0.

```bash
yarn install
# If not present already:
yarn add -D @graphprotocol/graph-cli@0.90.0 @graphprotocol/graph-ts@0.36.0
```

### Project layout
```
/abis
  IdeationMarketFacet.json
  BuyerWhitelistFacet.json
/src
  mapping.ts
/schema.graphql
/subgraph.yaml
```

---

## Build

```bash
# Generate AssemblyScript types from schema + ABIs
./node_modules/.bin/graph codegen

# Compile mappings to WASM
./node_modules/.bin/graph build
```

> If you see an event signature error, ensure the `event:` lines in `subgraph.yaml` match the ABI exactly (names, `indexed` flags, and argument order).

---

## Deploy to Subgraph Studio

1. Create a subgraph in Studio (slug suggestion: `ideation-market-graph-w3i`) and copy the Deploy Key.
2. Auth & deploy with the pinned CLI (no `--studio` flag needed in this version):

```bash
./node_modules/.bin/graph auth <YOUR_DEPLOY_KEY>
./node_modules/.bin/graph deploy ideation-market-graph-w3i
```

---

## Example queries

**Active listings by collection**
```graphql
query($c: Bytes!) {
  listings(
    where: { tokenAddress: $c, active: true }
    orderBy: createdAt
    orderDirection: desc
    first: 20
  ) {
    listingId
    tokenId
    tokenStandard
    priceTotal
    remainingQuantity
    listingType
    seller
    createdAt
  }
}
```

**Whitelist for one listing**
```graphql
query($listing: BigInt!) {
  whitelistedBuyers(
    where:{ listingId: $listing }
    first: 1000
  ) {
    buyer
    createdAt
  }
}
```

**All active listings for an NFT (721 or 1155)**
```graphql
query($c: Bytes!, $t: BigInt!) {
  listings(
    where: { tokenAddress: $c, tokenId: $t, active: true }
    orderBy: createdAt
    orderDirection: desc
    first: 100
  ) {
    listingId
    seller
    priceTotal
    remainingQuantity
    currency
  }
}
```

**Payment history for a listing**
```graphql
query($listing: BigInt!) {
  payments(
    where: { listingId: $listing }
    orderBy: timestamp
    orderDirection: asc
  ) {
    recipient
    amount
    currency
    paymentType
    timestamp
  }
}
```

**Currently whitelisted NFT collections**
```graphql
query {
  whitelistedCollections(
    where: { isWhitelisted: true }
    first: 100
  ) {
    collection
    addedAt
    lastUpdatedAt
  }
}
```

**Currently allowed payment currencies**
```graphql
query {
  allowedCurrencies(
    where: { isAllowed: true }
    first: 50
  ) {
    currency
    addedAt
    lastUpdatedAt
  }
}
```

---

## Dev notes

- `feeRate` stored as `BigInt` (contract uses denominator `100_000`; values are small but we keep it future‑proof).
- `unitPrice` is set only when partial buys are enabled and `erc1155QuantityListed > 1`.
- Buyer whitelist entries are **created** on `BuyerWhitelisted` and **deleted** on `BuyerRemovedFromWhitelist`.
- Collection/Currency whitelist entries are **never deleted**, only toggled via `isWhitelisted`/`isAllowed` boolean flags.
- All 4 data sources point to the same Diamond address but decode different events via separate ABIs (EIP-2535 pattern).

---

## License

MIT — see [LICENSE](LICENSE).