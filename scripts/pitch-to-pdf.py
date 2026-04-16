#!/usr/bin/env python3
"""Generate Relifish Pitch Deck PDF — matches the VC-ready HTML deck."""

from reportlab.lib.pagesizes import landscape, A4
from reportlab.lib.colors import HexColor, white
from reportlab.pdfgen import canvas
import os

W, H = landscape(A4)
OUT = os.path.expanduser("~/Desktop/Relifish-Pitch-Deck.pdf")

# Colors matching HTML deck
BLUE = HexColor("#2563EB")
BLUE_L = HexColor("#EFF6FF")
BLUE_M = HexColor("#DBEAFE")
GREEN = HexColor("#059669")
GREEN_L = HexColor("#ECFDF5")
ORANGE = HexColor("#EA580C")
ORANGE_L = HexColor("#FFF7ED")
RED = HexColor("#DC2626")
INK = HexColor("#0F172A")
INK2 = HexColor("#334155")
INK3 = HexColor("#64748B")
INK4 = HexColor("#94A3B8")
BG = HexColor("#FFFFFF")
BG2 = HexColor("#F8FAFC")
BORDER = HexColor("#E2E8F0")

class PitchDeck:
    def __init__(self, fn):
        self.c = canvas.Canvas(fn, pagesize=landscape(A4))
        self.w, self.h = W, H
        self.n = 0
        self.total = 14

    def _pg(self, label=None, bg=BG):
        self.n += 1
        self.c.setFillColor(bg)
        self.c.rect(0, 0, self.w, self.h, fill=1)
        if label and bg == BG:
            self.c.setFillColor(BLUE)
            self.c.setFont("Helvetica-Bold", 10)
            self.c.drawString(56, self.h - 44, label.upper())
        self.c.setFillColor(INK4)
        self.c.setFont("Helvetica", 9)
        self.c.drawRightString(self.w - 36, 18, f"{self.n} / {self.total}")

    def _h2(self, text, y=None, color=INK, size=28):
        if y is None: y = self.h - 82
        self.c.setFillColor(color)
        self.c.setFont("Helvetica-Bold", size)
        for i, line in enumerate(text.split("\n")):
            self.c.drawString(56, y - i*(size+6), line)
        return y - len(text.split("\n"))*(size+6)

    def _p(self, text, x, y, size=13, color=INK2, font="Helvetica", mw=None):
        self.c.setFillColor(color)
        self.c.setFont(font, size)
        if mw:
            words = text.split(); lines=[]; cur=""
            for w in words:
                t = cur+" "+w if cur else w
                if self.c.stringWidth(t, font, size) < mw: cur=t
                else: lines.append(cur); cur=w
            if cur: lines.append(cur)
            for i, l in enumerate(lines):
                self.c.drawString(x, y-i*(size+3), l)
            return y - len(lines)*(size+3)
        self.c.drawString(x, y, text)
        return y - size - 3

    def _bullet(self, text, x, y, size=12, bold=None):
        self.c.setFillColor(BLUE)
        self.c.circle(x+3, y+3, 2.5, fill=1)
        if bold:
            self.c.setFillColor(INK)
            self.c.setFont("Helvetica-Bold", size)
            self.c.drawString(x+12, y, bold)
            bw = self.c.stringWidth(bold, "Helvetica-Bold", size)
            self.c.setFillColor(INK2)
            self.c.setFont("Helvetica", size)
            self.c.drawString(x+12+bw, y, text[len(bold):])
        else:
            self.c.setFillColor(INK2)
            self.c.setFont("Helvetica", size)
            self.c.drawString(x+12, y, text)
        return y - (size+8)

    def _card(self, x, y, w, h, title, body, bg=BG2, border=BORDER):
        self.c.setFillColor(bg)
        self.c.roundRect(x, y, w, h, 8, fill=1, stroke=0)
        self.c.setStrokeColor(border)
        self.c.roundRect(x, y, w, h, 8, fill=0, stroke=1)
        self.c.setFillColor(INK)
        self.c.setFont("Helvetica-Bold", 12)
        self.c.drawString(x+14, y+h-20, title)
        self._p(body, x+14, y+h-36, size=9, color=INK3, mw=w-28)

    def _stat(self, x, y, num, label, src=None):
        self.c.setFillColor(BLUE)
        self.c.setFont("Helvetica-Bold", 36)
        self.c.drawCentredString(x, y+16, num)
        self.c.setFillColor(INK3)
        self.c.setFont("Helvetica", 10)
        self.c.drawCentredString(x, y-2, label)
        if src:
            self.c.setFillColor(INK4)
            self.c.setFont("Helvetica", 8)
            self.c.drawCentredString(x, y-14, src)

    def _callout(self, x, y, w, text):
        self.c.setFillColor(BLUE_L)
        self.c.roundRect(x, y, w, 30, 4, fill=1, stroke=0)
        self.c.setStrokeColor(BLUE)
        self.c.setLineWidth(2)
        self.c.line(x, y, x, y+30)
        self.c.setLineWidth(1)
        self.c.setFillColor(INK2)
        self.c.setFont("Helvetica", 9)
        self.c.drawString(x+10, y+10, text[:120])

    def _metric_bar(self, items, y):
        w = (self.w - 112) / len(items)
        for i, (v, d) in enumerate(items):
            x = 56 + i*w
            self.c.setFillColor(BLUE)
            self.c.rect(x, y+28, w-10, 2, fill=1)
            self.c.setFillColor(INK)
            self.c.setFont("Helvetica-Bold", 18)
            self.c.drawString(x, y+8, v)
            self.c.setFillColor(INK3)
            self.c.setFont("Helvetica", 9)
            self.c.drawString(x, y-4, d)

    # ============ SLIDES ============

    def s1_cover(self):
        self._pg(bg=INK)
        self.c.setFillColor(BLUE)
        self.c.setFont("Helvetica-Bold", 11)
        self.c.drawCentredString(self.w/2, self.h-140, "PRE-SEED  |  APRIL 2026")
        self.c.setFillColor(white)
        self.c.setFont("Helvetica-Bold", 60)
        self.c.drawCentredString(self.w/2, self.h/2+30, "Relifish")
        self.c.setFillColor(HexColor("#FFFFFFCC"))
        self.c.setFont("Helvetica", 19)
        self.c.drawCentredString(self.w/2, self.h/2-16, "India's Rs 1.7 Lakh Crore fish market has")
        self.c.drawCentredString(self.w/2, self.h/2-40, "25 million sellers and zero technology.")
        self.c.drawCentredString(self.w/2, self.h/2-64, "We're building the rails.")
        self.c.setFillColor(HexColor("#FFFFFF66"))
        self.c.setFont("Helvetica", 13)
        self.c.drawCentredString(self.w/2, 70, "relifish.store  |  Kunal Rawat, Founder")
        self.c.showPage()

    def s2_problem(self):
        self._pg("The Problem")
        self._h2("Two sides of the same broken market")
        y = self.h - 130
        # Left col
        self.c.setFillColor(ORANGE); self.c.setFont("Helvetica-Bold", 14)
        self.c.drawString(56, y, "Sellers lose 25% of catch daily")
        y2 = y - 24
        for b, r in [("No demand signal."," Haul, set up, hope. Unsold at 2pm = total loss."),
                     ("No pre-sell."," Can't take orders in advance. First come, first served."),
                     ("Limited reach."," Only walk-in customers within 500m of stall."),
                     ("<10% cold storage"," for India's total fish production.")]:
            y2 = self._bullet(b+r, 56, y2, size=11, bold=b)
        # Right col
        self.c.setFillColor(ORANGE); self.c.setFont("Helvetica-Bold", 14)
        self.c.drawString(430, y, "Buyers face friction at every step")
        y3 = y - 24
        for b, r in [("Wasted trips."," Travel to market, species sold out, leave empty."),
                     ("No price visibility."," Can't compare sellers. Haggling only."),
                     ("Time-locked."," Markets close 11am. Professionals can't access."),
                     ("Trust gap."," Delivery apps charge 25-30% markup. 2-3 days old.")]:
            y3 = self._bullet(b+r, 430, y3, size=11, bold=b)
        self._callout(56, 50, self.w-112, "Core insight: Rs 1.7L Cr/year traded — zero digital infrastructure. Not underserved. Unserved.")
        self.c.showPage()

    def s3_market(self):
        self._pg("Market Opportunity")
        self._h2("$22B market growing 7.5% CAGR.\n25M fishermen. Zero tech.")
        self._stat(160, 270, "$22.4B", "India domestic fish market", "IMARC 2025 | Rs 1.7L Cr")
        self._stat(420, 270, "71%", "Sold via wet markets", "54% fresh (not frozen)")
        self._stat(680, 270, "25M", "Fishermen at primary level", "1.2M coastal households | FAO")
        self._metric_bar([("25%","Post-harvest loss"),("8.9 kg","Per capita (+81%)"),("2x","Consumption by 2048"),("$7.4B","Exports FY25 MPEDA")], 170)
        self._callout(56, 50, self.w-112, "TAM: $22.4B (all India) > SAM: $3.2B (Mumbai metro fresh fish) > SOM: $8M (0.25% SAM in 3 yrs = Rs 65Cr GMV)")
        self.c.showPage()

    def s4_competitors(self):
        self._pg("Competitive Landscape")
        self._h2("$930M+ funded. None serve local fishermen.")
        data = [
            ["Player","Model","Raised","Revenue","Local","Pre-order","Gap"],
            ["FreshToHome","Inventory, cold chain","$320M","Rs 421Cr FY25","No","No","Warehouse. Replaces sellers."],
            ["Licious","Inventory, meat-first","$490M","Rs 845Cr FY25","No","No","Fish = 15% of revenue."],
            ["Captain Fresh","B2B export","$120M+","60%+ US/EU","No","No","Not consumer-facing."],
            ["Blinkit/Zepto","Quick commerce","$1.4B+","Rs 11,110Cr","No","No","Frozen/packaged."],
            ["Local market","Walk-in, cash","--","71% of retail","Yes","No","Zero digital."],
            ["Relifish","Marketplace","Pre-seed","MVP live","YES","YES","Only one for fishermen"],
        ]
        cw = [85,110,75,95,35,45,160]
        sy = self.h - 118
        for ri, row in enumerate(data):
            y = sy - ri*22
            for ci, cell in enumerate(row):
                x = 56 + sum(cw[:ci])
                if ri == 0:
                    self.c.setFont("Helvetica-Bold", 8); self.c.setFillColor(INK3)
                elif ri == len(data)-1:
                    self.c.setFont("Helvetica-Bold", 9); self.c.setFillColor(BLUE)
                else:
                    self.c.setFont("Helvetica", 9); self.c.setFillColor(INK2)
                # Color yes/no
                if cell in ("No",): self.c.setFillColor(RED)
                elif cell in ("Yes","YES"): self.c.setFillColor(GREEN)
                self.c.drawString(x, y, cell)
            if ri > 0:
                self.c.setStrokeColor(BORDER); self.c.line(56, y-4, self.w-56, y-4)
        self._callout(56, 46, self.w-112, "White space: Every funded player REPLACED local fishermen. Relifish EMPOWERS them. $930M+ to warehouses, $0 to 25M fishermen.")
        self.c.showPage()

    def s5_solution(self):
        self._pg("The Solution")
        self._h2("The marketplace layer between\nIndia's fishermen and their customers")
        y = self.h - 148
        self.c.setFillColor(INK); self.c.setFont("Helvetica-Bold", 14)
        self.c.drawString(56, y, "For Sellers"); self.c.drawString(430, y, "For Buyers")
        y -= 24
        for i, (s,b) in enumerate(zip(
            ["Daily catch listings — photo, species, price","Pre-orders — orders tonight, reserve catch tomorrow",
             "Seller dashboard — inventory, orders, revenue","WhatsApp-native — order notifications on WhatsApp",
             "Expanded reach — serve buyers beyond 500m"],
            ["Browse nearby sellers — compare prices","Pre-order tomorrow's catch — guaranteed species",
             "Pickup or delivery — scheduled slots","Price transparency — per-kg, no hidden markup",
             "Trust — seller profiles, photos, ratings"])):
            self._bullet(s, 56, y-i*22, size=10)
            self._bullet(b, 430, y-i*22, size=10)
        self.c.showPage()

    def s6_advantages(self):
        self._pg("Unfair Advantages")
        self._h2("Six structural reasons this works\nand incumbents can't copy it")
        cards = [
            ("1. Asset-light marketplace","No inventory. Sellers handle fulfillment. Pure platform take rate.",BLUE_L,BLUE_M),
            ("2. Pre-orders (nobody else)","Buyer orders tonight, seller reserves catch. Reduces 25% waste.",BLUE_L,BLUE_M),
            ("3. Zero-CAC distribution","1 seller = 50 buyers free. Sellers ARE the growth engine.",BLUE_L,BLUE_M),
            ("4. WhatsApp-native","500M+ on WhatsApp. Formalize the workflow sellers already have.",ORANGE_L,HexColor("#FED7AA")),
            ("5. Hyperlocal trust moat","Local trust doesn't transfer to warehouses. We digitize relationships.",ORANGE_L,HexColor("#FED7AA")),
            ("6. Category creation","$930M funded warehouses. $0 funded fishermen. New category.",ORANGE_L,HexColor("#FED7AA")),
        ]
        for i, (t, b, bg, bd) in enumerate(cards):
            col = i % 3
            row = i // 3
            x = 56 + col * 240
            y = 200 - row * 90
            self._card(x, y, 225, 80, t, b, bg=bg, border=bd)
        self.c.showPage()

    def s7_product(self):
        self._pg("Product")
        self._h2("Full MVP live at relifish.store")
        self._card(56, 250, 215, 75, "Buyer Experience", "Location-aware browse, species search, pre-order, pickup/delivery, tracking, WhatsApp")
        self._card(286, 250, 215, 75, "Seller Dashboard", "Inventory, order accept/reject, pricing tiers, schedule slots, revenue analytics")
        self._card(516, 250, 215, 75, "Pre-Order Engine", "Buyer requests > seller confirms morning price > buyer accepts > reserved at dock")
        items = [("Astro SSR","Server-rendered, fast on 3G"),("Supabase","Postgres + Auth + Realtime"),("Vercel","Edge deploy, zero DevOps"),("PWA","Installable + push notifs")]
        for i,(n,d) in enumerate(items):
            x = 56+i*185
            self.c.setFillColor(BLUE); self.c.rect(x,195,170,2,fill=1)
            self.c.setFillColor(INK); self.c.setFont("Helvetica-Bold",15); self.c.drawString(x,172,n)
            self.c.setFillColor(INK3); self.c.setFont("Helvetica",9); self.c.drawString(x,158,d)
        self._callout(56, 50, self.w-112, "Also built: Standees, banners, QR flyers, SEO + schema, sitemap, IndexNow, Marathi/English, privacy policy, security headers")
        self.c.showPage()

    def s8_business(self):
        self._pg("Business Model")
        self._h2("Platform take rate + 5 revenue streams")
        self._card(56, 215, 210, 95, "NOW: 5-8% Commission", "Tiered: 5% to Rs 50K, 7% to Rs 2L, 8% above. Free to list. Pay on sale only.", bg=BLUE_L, border=BLUE_M)
        self._card(281, 215, 210, 95, "M4+: Delivery Fees", "Distance-based Rs 30-79. Free above Rs 1,000 (pushes AOV up 40-60%).", bg=ORANGE_L, border=HexColor("#FED7AA"))
        self._card(506, 215, 210, 95, "M6+: B2B Channel", "Restaurants, hotels. Rs 3,500+ AOV. 3x/week. 10x consumer order.", bg=GREEN_L, border=HexColor("#A7F3D0"))
        self._metric_bar([("Rs 820","Blended AOV"),("Rs 53","Commission/order (6.5%)"),("2-3x/wk","Purchase frequency"),("Rs 4,018","LTV per buyer")], 130)
        self._callout(56, 50, self.w-112, "Future: Seller subscriptions (Rs 999-2,499/mo) + promoted listings (CPC Rs 2-5) + market data (Rs 10-25K/mo to institutions)")
        self.c.showPage()

    def s9_unit_economics(self):
        self._pg("Unit Economics")
        self._h2("Path to contribution-positive by Month 7")
        # Left: per-order P&L
        items_l = [("GMV","Rs 820"),("Commission (6.5%)","Rs 53"),("Delivery fee (avg)","Rs 25"),
                   ("Gross revenue","Rs 78"),("Delivery cost","-Rs 45"),("Payment (2%)","-Rs 16"),
                   ("Packaging","-Rs 12"),("Gross margin","Rs 5")]
        y = self.h - 120
        self.c.setFillColor(INK); self.c.setFont("Helvetica-Bold", 12)
        self.c.drawString(56, y, "Per Order (Month 6)")
        y -= 20
        for label, val in items_l:
            bold = label in ("Gross revenue","Gross margin")
            self.c.setFont("Helvetica-Bold" if bold else "Helvetica", 10)
            self.c.setFillColor(INK if bold else INK2)
            self.c.drawString(56, y, label)
            self.c.setFillColor(GREEN if val.startswith("Rs 78") or val == "Rs 5" else INK2)
            self.c.drawRightString(300, y, val)
            y -= 16
        self._callout(56, y-10, 280, "M12 target: Rs 40/order (4.9%) gross margin")

        # Right: key metrics
        items_r = [("Blended CAC","Rs 130"),("LTV (conservative)","Rs 2,657"),("LTV (target)","Rs 4,018"),
                   ("LTV:CAC ratio","31:1"),("Payback period","3.7 months"),("D30 retention target","40%+"),
                   ("Orders/buyer/month","7")]
        y = self.h - 120
        self.c.setFillColor(INK); self.c.setFont("Helvetica-Bold", 12)
        self.c.drawString(430, y, "Key Metrics")
        y -= 20
        for label, val in items_r:
            bold = "LTV:CAC" in label
            self.c.setFont("Helvetica-Bold" if bold else "Helvetica", 10)
            self.c.setFillColor(INK if bold else INK2)
            self.c.drawString(430, y, label)
            self.c.setFillColor(GREEN if "31:1" in val else INK2)
            self.c.setFont("Helvetica-Bold" if bold else "Helvetica", 10)
            self.c.drawRightString(self.w - 56, y, val)
            y -= 16
        self._callout(430, y-10, self.w-486, "High LTV:CAC because fish = non-discretionary, high-frequency (2-3x/week)")
        self.c.showPage()

    def s10_projections(self):
        self._pg("12-Month Projections")
        self._h2("Rs 1.58Cr monthly GMV by Month 12.\nBreak-even at Month 7.")
        rows = [
            ["Month","Orders/Day","AOV","Monthly GMV","Revenue","Expenses","Burn"],
            ["M1","30","Rs 650","Rs 5.8L","Rs 19K","Rs 4.5L","-Rs 4.3L"],
            ["M3","100","Rs 750","Rs 22.5L","Rs 1.1L","Rs 5.5L","-Rs 4.4L"],
            ["M6","280","Rs 820","Rs 68.9L","Rs 5.5L","Rs 7.0L","-Rs 1.5L"],
            ["M7*","350","Rs 830","Rs 87.2L","Rs 7.9L","Rs 7.5L","+Rs 35K"],
            ["M9","450","Rs 850","Rs 1.15Cr","Rs 11.5L","Rs 8.5L","+Rs 3.0L"],
            ["M12","600","Rs 880","Rs 1.58Cr","Rs 18.2L","Rs 10.0L","+Rs 8.2L"],
        ]
        cw = [50,70,60,90,80,75,75]
        sy = self.h - 128
        for ri, row in enumerate(rows):
            y = sy - ri*22
            is_green = ri == 4  # M7 = breakeven
            for ci, cell in enumerate(row):
                x = 56 + sum(cw[:ci])
                if ri == 0:
                    self.c.setFont("Helvetica-Bold", 8); self.c.setFillColor(INK3)
                elif is_green:
                    self.c.setFont("Helvetica-Bold", 10); self.c.setFillColor(GREEN)
                elif cell.startswith("+"):
                    self.c.setFont("Helvetica-Bold", 10); self.c.setFillColor(GREEN)
                elif cell.startswith("-"):
                    self.c.setFont("Helvetica", 10); self.c.setFillColor(RED)
                else:
                    self.c.setFont("Helvetica", 10); self.c.setFillColor(INK2)
                self.c.drawString(x, y, cell)
            if ri > 0:
                self.c.setStrokeColor(BORDER); self.c.line(56, y-4, 556, y-4)
        # Callouts
        self._callout(56, 55, 230, "Peak burn: Rs 21.7L (M1-6). Covered by Rs 25L raise.")
        self._callout(300, 55, 230, "M12: Rs 18.2L/mo rev. 350+ sellers. 22K orders/mo.")
        self._callout(544, 55, 220, "Seed trigger: M12 numbers > Rs 1Cr at Rs 8-10Cr val.")
        self.c.showPage()

    def s11_gtm(self):
        self._pg("Go-to-Market")
        self._h2("Neighborhood-by-neighborhood.\nPhysical-first. Zero paid CAC to start.")
        steps = [("WEEK 1-2","WhatsApp concierge — manual ops, 1 seller, 20 buyers. Validate demand."),
                 ("MONTH 1","3 power sellers — standees + QR at stalls. Each seller brings 10-20 buyers."),
                 ("MONTH 2-3","Market-level — one full Mumbai fish market. 10+ sellers, 100+ buyers. First ads."),
                 ("MONTH 4-6","Second market + B2B — prove playbook replicates. 5 restaurants. Delivery pilot.")]
        y = 260
        for per, act in steps:
            self.c.setFillColor(BLUE); self.c.circle(70, y+6, 4, fill=1); self.c.rect(68, y-36, 2, 42, fill=1)
            self.c.setFont("Helvetica-Bold", 9); self.c.setFillColor(BLUE); self.c.drawString(84, y+8, per)
            self.c.setFillColor(INK2); self.c.setFont("Helvetica", 10); self.c.drawString(84, y-6, act)
            y -= 50
        self._card(430, 110, 320, 100, "Why this works", "Sellers ARE distribution. 1 seller = 50-200 regulars. They say 'I'm on Relifish' > those buyers follow. No ads needed for first 500 buyers.", bg=BG2)
        self._card(430, 55, 320, 45, "Already built", "Standees, banners, QR flyers, seller cards — designed, ready to print.", bg=BLUE_L, border=BLUE_M)
        self.c.showPage()

    def s12_why(self):
        self._pg("Why Now | Why Us")
        self._h2("The timing is perfect.\nThe builder is ready.")
        y = self.h - 140
        self.c.setFillColor(INK); self.c.setFont("Helvetica-Bold", 13); self.c.drawString(56, y, "Why Now"); y -= 22
        for b, r in [("$930M+ proved category."," FreshToHome + Licious proved online fish buying. None built for sellers."),
                     ("800M phones, 500M WhatsApp."," Fishermen already run informal WhatsApp groups."),
                     ("UPI: 16B+ txns/month."," Digital payments mainstream at every fish market."),
                     ("25% post-harvest loss = Rs 35K Cr/yr."," Pre-orders directly address this waste."),
                     ("Consumption doubling."," 8.9kg today > 16kg by 2048. Demand growing, supply chain isn't.")]:
            y = self._bullet(b+r, 56, y, size=10, bold=b)

        y2 = self.h - 140
        self.c.setFillColor(INK); self.c.setFont("Helvetica-Bold", 13); self.c.drawString(430, y2, "Why Me"); y2 -= 22
        for b, r in [("Full-stack solo founder."," Built entire marketplace in weeks."),
                     ("Domain obsession."," Deep understanding of Indian fish markets."),
                     ("Lean operator."," Zero burn pre-funding. Free-tier infra. Test before build."),
                     ("Velocity proof."," MVP + SEO + marketing materials + 55K-word playbook — pre-funding.")]:
            y2 = self._bullet(b+r, 430, y2, size=10, bold=b)
        self._card(430, 65, 320, 55, "Shipped pre-funding", "Marketplace, seller dashboard, pre-orders, pickup/delivery, WhatsApp, Marathi support, standees, 55K-word marketing playbook.", bg=BLUE_L, border=BLUE_M)
        self.c.showPage()

    def s13_ask(self):
        self._pg("The Ask")
        self._h2("Pre-Seed Round")
        # Blue box
        self.c.setFillColor(BLUE)
        self.c.roundRect(56, 310, self.w-112, 80, 12, fill=1)
        self.c.setFillColor(white); self.c.setFont("Helvetica-Bold", 40)
        self.c.drawCentredString(self.w/2, 348, "Rs 25 Lakhs")
        self.c.setFont("Helvetica", 14)
        self.c.drawCentredString(self.w/2, 322, "6 months runway | 3 fish markets | Prove playbook | Scale Mumbai")
        # Three cards
        self._card(56, 75, 215, 210, "Use of Funds", "Seller acquisition (3 markets)\nPhysical marketing + standees\nDelivery pilot (2 zones)\nPaid ads (Rs 3L / 6 months)\n6 months founder runway")
        self._card(286, 75, 215, 210, "6-Month Milestones", "50+ active sellers\n280 orders/day\nRs 68.9L monthly GMV\n40%+ D30 retention\nContribution-margin positive")
        self._card(516, 75, 215, 210, "Then: Seed Round", "Rs 1Cr at Rs 8-10Cr valuation\nExpand Mumbai-wide (5+ markets)\nOwn delivery logistics\nB2B: 20+ restaurants\nCoastal Maharashtra expansion")
        self.c.showPage()

    def s14_end(self):
        self._pg(bg=INK)
        self.c.setFillColor(white); self.c.setFont("Helvetica-Bold", 52)
        self.c.drawCentredString(self.w/2, self.h/2+45, "Relifish")
        self.c.setFillColor(HexColor("#FFFFFFBB")); self.c.setFont("Helvetica", 17)
        self.c.drawCentredString(self.w/2, self.h/2-2, "Building the rails for India's Rs 1.7 Lakh Crore fish market.")
        self.c.drawCentredString(self.w/2, self.h/2-24, "One seller at a time.")
        self.c.setFillColor(BLUE); self.c.setFont("Helvetica-Bold", 15)
        self.c.drawCentredString(self.w/2, self.h/2-65, "relifish.store")
        self.c.setFillColor(HexColor("#FFFFFF88")); self.c.setFont("Helvetica", 13)
        self.c.drawCentredString(self.w/2, self.h/2-90, "Kunal Rawat  |  Founder")
        self.c.showPage()

    def build(self):
        self.s1_cover()
        self.s2_problem()
        self.s3_market()
        self.s4_competitors()
        self.s5_solution()
        self.s6_advantages()
        self.s7_product()
        self.s8_business()
        self.s9_unit_economics()
        self.s10_projections()
        self.s11_gtm()
        self.s12_why()
        self.s13_ask()
        self.s14_end()
        self.c.save()
        print(f"PDF saved: {OUT}")

if __name__ == "__main__":
    PitchDeck(OUT).build()
