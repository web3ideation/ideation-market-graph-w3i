// src/mapping.ts
import { BigInt, Address, store } from "@graphprotocol/graph-ts";

// -------- Marketplace facet events (from data source: IdeationMarketDiamond) --------
import {
  ListingCreated,
  ListingUpdated as EvListingUpdated,
  ListingPurchased,
  ListingCanceled,
  ListingCanceledDueToInvalidListing,
  InnovationFeePaid,
  RoyaltyPaid,
  SellerProceedsPaid,
} from "../generated/IdeationMarketDiamond/IdeationMarketFacet";

// -------- Buyer whitelist facet events (from data source: BuyerWhitelist) --------
import {
  BuyerWhitelisted,
  BuyerRemovedFromWhitelist,
} from "../generated/BuyerWhitelist/BuyerWhitelistFacet";

// -------- Collection whitelist facet events --------
import {
  CollectionAddedToWhitelist,
  CollectionRemovedFromWhitelist,
} from "../generated/CollectionWhitelist/CollectionWhitelistFacet";

// -------- Currency whitelist facet events --------
import {
  CurrencyAllowed,
  CurrencyRemoved,
} from "../generated/CurrencyWhitelist/CurrencyWhitelistFacet";

import {
  Listing,
  WhitelistedBuyer,
  Payment,
  WhitelistedCollection,
  AllowedCurrency,
} from "../generated/schema";

const CHAIN_ID = 11155111; // Sepolia

// ------------------------- helpers -------------------------

function listingEntityId(listingId: BigInt): string {
  // id = "<chainId>-<listingId>"
  return CHAIN_ID.toString() + "-" + listingId.toString();
}

function whitelistEntityId(listingId: BigInt, buyer: Address): string {
  // id = "<chainId>-<listingId>-<buyer>"
  return (
    CHAIN_ID.toString() + "-" + listingId.toString() + "-" + buyer.toHexString()
  );
}

function tokenStandardFromQty(qty: BigInt): string {
  return qty.equals(BigInt.zero()) ? "ERC721" : "ERC1155";
}

function listingType(price: BigInt, desired: Address): string {
  // PURE_ETH if no desired token; otherwise SWAP_AND_ETH if price>0, else PURE_SWAP
  if (desired.equals(Address.zero())) return "PURE_ETH";
  return price.gt(BigInt.zero()) ? "SWAP_AND_ETH" : "PURE_SWAP";
}

// ------------------------- marketplace handlers -------------------------

export function handleListingCreated(ev: ListingCreated): void {
  const id = listingEntityId(ev.params.listingId);
  const l = new Listing(id);

  l.chainId = CHAIN_ID;
  l.listingId = ev.params.listingId;

  l.tokenAddress = ev.params.tokenAddress;
  l.tokenId = ev.params.tokenId;
  l.tokenStandard = tokenStandardFromQty(ev.params.erc1155Quantity);

  if (ev.params.erc1155Quantity.gt(BigInt.zero())) {
    l.erc1155QuantityListed = ev.params.erc1155Quantity;
    l.remainingQuantity = ev.params.erc1155Quantity;
  }

  l.priceTotal = ev.params.price;
  l.currency = ev.params.currency;

  if (
    ev.params.partialBuyEnabled &&
    ev.params.erc1155Quantity.gt(BigInt.zero())
  ) {
    // contract guarantees divisibility when partialBuyEnabled
    l.unitPrice = ev.params.price.div(ev.params.erc1155Quantity);
  }

  l.buyerWhitelistEnabled = ev.params.buyerWhitelistEnabled;
  l.partialBuyEnabled = ev.params.partialBuyEnabled;

  l.listingType = listingType(ev.params.price, ev.params.desiredTokenAddress);
  l.feeRate = ev.params.feeRate;

  l.desiredTokenAddress = ev.params.desiredTokenAddress;
  l.desiredTokenId = ev.params.desiredTokenId;
  l.desiredErc1155Quantity = ev.params.desiredErc1155Quantity;

  l.seller = ev.params.seller;

  l.status = "LISTED";
  l.active = true;
  l.createdAt = ev.block.timestamp;

  l.save();
}

export function handleListingUpdated(ev: EvListingUpdated): void {
  const id = listingEntityId(ev.params.listingId);
  const l = Listing.load(id);
  if (l == null) return;

  // mutable fields
  l.priceTotal = ev.params.price;
  l.currency = ev.params.currency;
  l.feeRate = ev.params.feeRate;
  l.buyerWhitelistEnabled = ev.params.buyerWhitelistEnabled;
  l.partialBuyEnabled = ev.params.partialBuyEnabled;

  // quantities (new total for ERC1155; remainingQuantity updates on purchase only)
  if (ev.params.erc1155Quantity.gt(BigInt.zero())) {
    l.erc1155QuantityListed = ev.params.erc1155Quantity;
    if (l.partialBuyEnabled) {
      l.unitPrice = ev.params.price.div(ev.params.erc1155Quantity);
    } else {
      l.unitPrice = null;
    }
  } else {
    l.erc1155QuantityListed = null;
    l.unitPrice = null;
  }

  // swap target + type
  l.desiredTokenAddress = ev.params.desiredTokenAddress;
  l.desiredTokenId = ev.params.desiredTokenId;
  l.desiredErc1155Quantity = ev.params.desiredErc1155Quantity;
  l.listingType = listingType(ev.params.price, ev.params.desiredTokenAddress);

  // standard (guarded in contract, but keep deterministic here)
  l.tokenStandard = tokenStandardFromQty(ev.params.erc1155Quantity);

  l.save();
}

export function handleListingPurchased(ev: ListingPurchased): void {
  const id = listingEntityId(ev.params.listingId);
  const l = Listing.load(id);
  if (l == null) return;

  if (ev.params.erc1155Quantity.gt(BigInt.zero())) {
    // partial/full fill for ERC1155
    const currentRemaining = l.remainingQuantity
      ? l.remainingQuantity!
      : BigInt.zero();
    let nextRemaining = currentRemaining.minus(ev.params.erc1155Quantity);
    if (nextRemaining.lt(BigInt.zero())) nextRemaining = BigInt.zero();
    l.remainingQuantity = nextRemaining;

    // event.price is the purchasePrice for this fill
    const currentTotal = l.priceTotal;
    let nextTotal = currentTotal.minus(ev.params.price);
    if (nextTotal.lt(BigInt.zero())) nextTotal = BigInt.zero();
    l.priceTotal = nextTotal;

    if (nextRemaining.gt(BigInt.zero())) {
      l.status = "PARTIALLY_FILLED";
      l.active = true;
    } else {
      l.status = "SOLD_OUT";
      l.active = false;
    }
  } else {
    // ERC721 sold
    l.status = "SOLD_OUT";
    l.active = false;
    l.priceTotal = BigInt.zero();
  }

  l.save();
}

export function handleListingCanceled(ev: ListingCanceled): void {
  const id = listingEntityId(ev.params.listingId);
  const l = Listing.load(id);
  if (l == null) return;

  l.status = "CANCELED";
  l.active = false;
  l.save();
}

export function handleListingInvalidated(
  ev: ListingCanceledDueToInvalidListing
): void {
  const id = listingEntityId(ev.params.listingId);
  const l = Listing.load(id);
  if (l == null) return;

  l.status = "INVALIDATED";
  l.active = false;
  l.save();
}

// ------------------------- whitelist handlers -------------------------

export function handleBuyerWhitelisted(ev: BuyerWhitelisted): void {
  const id = whitelistEntityId(ev.params.listingId, ev.params.buyer);
  let wb = WhitelistedBuyer.load(id);
  if (wb == null) {
    wb = new WhitelistedBuyer(id);
    wb.chainId = CHAIN_ID;
    wb.listingId = ev.params.listingId;
    wb.buyer = ev.params.buyer;
    wb.createdAt = ev.block.timestamp;
  }
  wb.save();
}

export function handleBuyerRemovedFromWhitelist(
  ev: BuyerRemovedFromWhitelist
): void {
  const id = whitelistEntityId(ev.params.listingId, ev.params.buyer);
  store.remove("WhitelistedBuyer", id);
}

// ------------------------- payment tracking handlers -------------------------

function paymentEntityId(txHash: string, logIndex: BigInt): string {
  // id = "<chainId>-<txHash>-<logIndex>"
  return CHAIN_ID.toString() + "-" + txHash + "-" + logIndex.toString();
}

function collectionEntityId(collection: Address): string {
  // id = "<chainId>-<collectionAddress>"
  return CHAIN_ID.toString() + "-" + collection.toHexString();
}

function currencyEntityId(currency: Address): string {
  // id = "<chainId>-<currencyAddress>"
  return CHAIN_ID.toString() + "-" + currency.toHexString();
}

export function handleInnovationFeePaid(ev: InnovationFeePaid): void {
  const id = paymentEntityId(ev.transaction.hash.toHexString(), ev.logIndex);
  const payment = new Payment(id);

  payment.chainId = CHAIN_ID;
  payment.listingId = ev.params.listingId;
  payment.recipient = ev.params.marketplaceOwner;
  payment.currency = ev.params.currency;
  payment.amount = ev.params.innovationFee;
  payment.paymentType = "INNOVATION_FEE";
  payment.timestamp = ev.block.timestamp;
  payment.txHash = ev.transaction.hash;
  payment.blockNumber = ev.block.number;

  payment.save();
}

export function handleRoyaltyPaid(ev: RoyaltyPaid): void {
  const id = paymentEntityId(ev.transaction.hash.toHexString(), ev.logIndex);
  const payment = new Payment(id);

  payment.chainId = CHAIN_ID;
  payment.listingId = ev.params.listingId;
  payment.recipient = ev.params.royaltyReceiver;
  payment.currency = ev.params.currency;
  payment.amount = ev.params.royaltyAmount;
  payment.paymentType = "ROYALTY";
  payment.timestamp = ev.block.timestamp;
  payment.txHash = ev.transaction.hash;
  payment.blockNumber = ev.block.number;

  payment.save();
}

export function handleSellerProceedsPaid(ev: SellerProceedsPaid): void {
  const id = paymentEntityId(ev.transaction.hash.toHexString(), ev.logIndex);
  const payment = new Payment(id);

  payment.chainId = CHAIN_ID;
  payment.listingId = ev.params.listingId;
  payment.recipient = ev.params.seller;
  payment.currency = ev.params.currency;
  payment.amount = ev.params.sellerProceeds;
  payment.paymentType = "SELLER_PROCEEDS";
  payment.timestamp = ev.block.timestamp;
  payment.txHash = ev.transaction.hash;
  payment.blockNumber = ev.block.number;

  payment.save();
}

// ------------------------- collection whitelist handlers -------------------------

export function handleCollectionAddedToWhitelist(
  ev: CollectionAddedToWhitelist
): void {
  const id = collectionEntityId(ev.params.tokenAddress);
  let wc = WhitelistedCollection.load(id);

  if (wc == null) {
    wc = new WhitelistedCollection(id);
    wc.chainId = CHAIN_ID;
    wc.collection = ev.params.tokenAddress;
    wc.addedAt = ev.block.timestamp;
  }

  wc.isWhitelisted = true;
  wc.lastUpdatedAt = ev.block.timestamp;
  wc.save();
}

export function handleCollectionRemovedFromWhitelist(
  ev: CollectionRemovedFromWhitelist
): void {
  const id = collectionEntityId(ev.params.tokenAddress);
  let wc = WhitelistedCollection.load(id);

  if (wc == null) {
    // Shouldn't happen, but handle gracefully
    wc = new WhitelistedCollection(id);
    wc.chainId = CHAIN_ID;
    wc.collection = ev.params.tokenAddress;
    wc.addedAt = ev.block.timestamp;
  }

  wc.isWhitelisted = false;
  wc.lastUpdatedAt = ev.block.timestamp;
  wc.save();
}

// ------------------------- currency whitelist handlers -------------------------

export function handleCurrencyAllowed(ev: CurrencyAllowed): void {
  const id = currencyEntityId(ev.params.currency);
  let ac = AllowedCurrency.load(id);

  if (ac == null) {
    ac = new AllowedCurrency(id);
    ac.chainId = CHAIN_ID;
    ac.currency = ev.params.currency;
    ac.addedAt = ev.block.timestamp;
  }

  ac.isAllowed = true;
  ac.lastUpdatedAt = ev.block.timestamp;
  ac.save();
}

export function handleCurrencyRemoved(ev: CurrencyRemoved): void {
  const id = currencyEntityId(ev.params.currency);
  let ac = AllowedCurrency.load(id);

  if (ac == null) {
    // Shouldn't happen, but handle gracefully
    ac = new AllowedCurrency(id);
    ac.chainId = CHAIN_ID;
    ac.currency = ev.params.currency;
    ac.addedAt = ev.block.timestamp;
  }

  ac.isAllowed = false;
  ac.lastUpdatedAt = ev.block.timestamp;
  ac.save();
}
