# Respiratory Mechanics Lab

Browser-based pulmonary physiology teaching model for MEDC 30504 (Tissues, Cells & Organ Physiology), Pritzker School of Medicine. Open the published website; no installation or GitHub account is required.

Live site: https://beiser-lab.github.io/respiratory-mechanics-lab/

## Status

Experimental teaching model. The first module covers lung and chest wall statics: students change lung compliance, chest wall compliance, inward load on the chest wall, and respiratory muscle strength, then follow the relaxation pressure–volume curves, FRC, TLC, RV, VC, ERV, recoil pressures, and compliances. A pulmonary function test module is planned. Not for patient care.

It shares its look with [Circulation Lab](https://github.com/beiser-lab/circulation-lab) so the two can later be combined.

## Model

The lung and chest wall share one volume, so at each volume their recoil pressures add:

    Prs(V) = PL(V) + Pcw(V)        and so        1/Crs = 1/CL + 1/Ccw

These are compliances in series. Adding the two volumes at the same pressure (the parallel rule) gives the wrong combined curve.

- Lung: Salazar–Knowles exponential, V = Vmax − (Vmax − V0)·exp(−kP), with V0 1.5 L and Vmax 6.4 L. Compliance changes rotate the curve about V0.
- Chest wall: logistic curve with a resting volume of 4.0 L. Compliance changes pivot it at 1.5 L (near RV), so a stiffer chest wall lowers its resting volume and FRC. Inward load (obesity, ascites, pregnancy) shifts the curve to the right.
- TLC and RV are the volumes where maximal inspiratory and expiratory muscle effort balance the system's recoil, calibrated to 6.0 L and 1.5 L.
- Healthy values: FRC 3.0 L, CL 0.25, Ccw 0.18, Crs 0.10 L/cmH2O.

The model is static, so it has no airway closure. RV does not rise in emphysema here; that belongs in the planned PFT module.

## Development

Requires Node.js for tests and Python 3 for the local server.

```sh
npm test
npm start
```

Open http://localhost:4174. Application files are in `dist/`. GitHub Pages serves the `gh-pages` branch, containing only these static files.

Publish updates after tests pass:

```sh
git push origin main
git subtree push --prefix dist origin gh-pages
```
