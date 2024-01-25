# addin-last-insert-key
This Add-In automates the generation of a report for the most recent assignment of an NFC key or driver to a vehicle within the from date. Options are provided to select the from date and sorting. Generation of a downloadable report is accomplished with a single click.


## Installation
Add the configuration below to the to the system setting -> add-ins section of the MyGeotab database

```json
{
  "name": "Last Insert Key Report",
  "supportEmail": "support@geotab.com",
  "version": "0.0.1",
  "items": [{
    "url": "https://cdn.jsdelivr.net/gh/Geotab/addin-last-insert-key@master/dist/lastInsertKey.html",
    "path": "ActivityLink/",
    "menuName": {
      "en": "Last Insert Key"
    },
    "icon": "https://cdn.jsdelivr.net/gh/Geotab/addin-last-insert-key@master/dist/images/icon.png"
  }]
}
```