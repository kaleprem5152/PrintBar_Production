# PrintBar SGU Kiosk Commissioning & Deployment Guide

## 1. Hardware Architecture (Sanjay Ghodawat University — Food Court)
- **Kiosk Unit**: `PB-K01` (PrintBar SGU Foodcourt)
- **Controller**: Raspberry Pi 5 (8GB RAM, Raspberry Pi OS 64-bit Debian Bookworm)
- **Monochrome Printer**: Kyocera ECOSYS PA3500x (Primary B&W, 250-sheet tray, CUPS Queue: `printbar-kyocera`)
- **Colour Printer**: Canon MAXIFY GX6170 (Colour + B&W Fallback, 250-sheet tray, CUPS Queue: `printbar-canon`)
- **Networking**: Gigabit Ethernet switch connecting the Pi, both printers, and campus network uplink.

---

## 2. Automated Production Installation

1. Clone repository directly onto Raspberry Pi 5:
```bash
git clone https://github.com/kaleprem5152/PrintBar_Production.git /tmp/printbar-source
cd /tmp/printbar-source/printbar-product-design-project/raspberry-pi-agent
```

2. Run the production installer:
```bash
sudo bash install.sh
```
This automatically establishes:
- Standard paths: `/opt/printbar/agent`, `/opt/printbar/venv`, `/var/lib/printbar`
- System user: `printbar` with minimal locked sudo privileges
- Systemd units: `printbar-agent.service` and `printbar-kiosk.service`
- Config file: `/etc/printbar/printbar.env` (permissions 0640)

3. Configure static network printers:
```bash
sudo bash configure-printers.sh
```
Enter the reserved LAN IP addresses for the Kyocera and Canon printers.

4. Run the health verification tool:
```bash
sudo bash doctor.sh
```

---

## 3. On-Site Hardware Acceptance Checklist (Commissioning Tests)

Before declaring the kiosk open for university students, verify each item:

| Step | Acceptance Test | Expected Result | Verified |
| :--- | :--- | :--- | :--- |
| **HAT-01** | Power-on bootstrap | Pi 5 boots unattended into Chromium kiosk mode at `/kiosk` | [ ] |
| **HAT-02** | Agent startup | `systemctl status printbar-agent` reports `active (running)` | [ ] |
| **HAT-03** | Dual Heartbeat | Admin dashboard `/admin/printers` updates both printers as `READY` | [ ] |
| **HAT-04** | Remote Test Print | Admin triggers "Test Print" -> physical page ejects from Kyocera | [ ] |
| **HAT-05** | Colour Test Print | Admin triggers "Test Print" -> physical page ejects from Canon | [ ] |
| **HAT-06** | End-to-End B&W Job | Upload 2-page PDF -> Pay ₹4 -> Enter PIN -> Kyocera prints | [ ] |
| **HAT-07** | End-to-End Colour Job | Upload 1-page PDF -> Pay ₹8 -> Enter PIN -> Canon prints | [ ] |
| **HAT-08** | Paper Out Block | Lower paper count to 0 -> UI and API block payments and uploads | [ ] |
| **HAT-09** | Paper Refill | Admin clicks "Refill (+250)" -> Counter sets to 250 -> Kiosk unlocks | [ ] |
| **HAT-10** | Cable Pull Failover | Mid-print disconnect of Kyocera Ethernet -> Canon completes remainder without duplicating pages | [ ] |
| **HAT-11** | File Privacy Shredding | `/var/lib/printbar/jobs` is completely empty after job finishes | [ ] |
| **HAT-12** | Pi Power Failure Recovery | Cut power to Pi mid-print -> Upon boot, agent reports recovery to cloud | [ ] |

---

## 4. Emergency Procedures

### Clear Paper Jam / Stuck Queue
From the Admin Control Centre (`/admin/printers`), click **Clear Stuck Jobs**.
Or from terminal:
```bash
sudo cancel -a printbar-kyocera
sudo cancel -a printbar-canon
```

### Restart Print Daemon
```bash
sudo systemctl restart cups
sudo systemctl restart printbar-agent
```

### Paper Refills
When the physical paper tray is reloaded with a 250-sheet ream:
1. Log in to the Admin Dashboard (`https://printbarproduction-production.up.railway.app/admin`).
2. Go to **Printers** or **Kiosks**.
3. Click **Refill Tray (+250)**.
