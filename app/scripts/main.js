geotab.addin.lastInsertKey = (api, state) => {
	var container = document.getElementById("lastInsertKey"),
		gridContainer = document.querySelector(".lastInsertKey-grid"),
		runReportButton = container.querySelector("#lastInsertKey-runReport"),
		dateContainer = document.querySelector("#lastInsertKey-dateFrom"),
		sortByNameButton = document.querySelector("#lastInsertKey-sortByName"),
		sortByDateButton = document.querySelector("#lastInsertKey-sortByDate"),
		sortByTypeButton = document.querySelector("#lastInsertKey-sortByType"),
		exportButton = document.querySelector("#lastInsertKey-exportToXLSX"),
		alertError = document.querySelector(".alert-error"),

		errorMessageTimer,
		errorHandler = msg => {
			alertError.textContent = msg;
			alertError.classList.remove("hidden");
			clearTimeout(errorMessageTimer);
			errorMessageTimer = setTimeout(() => {
				alertError.classList.add("hidden");
			}, 3500);
		},
		initialize = () => {
			runReportButton.addEventListener("click", applyOptions, false);
			sortByNameButton.addEventListener("click", sortByName, false);
			sortByDateButton.addEventListener("click", sortByDate, false);
			sortByTypeButton.addEventListener("click", sortByType, false);
			if (typeof (window.Blob) !== "undefined") {
				exportButton.addEventListener("click", exportToXLSX, false);
			} else {
				exportButton.style.display = "none";
			}
		},
		isValidDateString = dateString => {
			var testDate = new Date(dateString);
			return !window.isNaN(testDate.getTime())
		},
		applyOptions = () => {
			var fromDateString = dateContainer.value,
				fromDate,
				drivers = driversInput.getValue();

			if (isValidDateString(fromDateString)) {
				fromDate = (new Date(fromDateString)).valueOf();
				loadChanges(fromDate, drivers || []);
			} else {
				errorHandler("Invalid date! The correct format is \"mm/dd/yyyy\"");
			}
		},
		focus = () => {
			var date;

			container.className = "";

			api.call("Get", {
				typeName: "User",
				search: {
					isDriver: true,
					driverGroups: state.getGroupFilter()
				},
				resultsLimit: 100
			}, drivers => {
				driversInput.setOptions(drivers);
				driversStorage.add(drivers);
			}, loadErrorHandler);

			date = (new Date()).toISOString();
			dateContainer.setAttribute("max", date.substr(0, 10));

			driversInput.focus();
		},
		loadErrorHandler = error => {
			if (!error.isAborted) {
				errorHandler(error.message || error);
			}
		},
		LOAD_PERIOD = 14 * 24 * 60 * 60 * 1000, // two weeks
		loadEndDate,
		loadedCount,
		lastInsertKeys,
		loadChanges = (fromDate, drivers) => {
			loadEndDate = (new Date()).valueOf();
			lastInsertKeys = {};
			loadedCount = 0;
			progress.show();
			exportButton.setAttribute("disabled", "disabled");
			if (fromDate) {
				loadPartOfChanges(fromDate, null, drivers);
			} else {
				api.call("GetCountOf", {
					typeName: "DriverChange"
				}, countOfChanges => {
					loadPartOfChanges(null, countOfChanges, drivers);
				}, loadErrorHandler);
			}
		},
		loadPartOfChanges = (fromDate, countOfChanges, drivers) => {
			var to = new Date(loadEndDate),
				from,
				driverChangeSearch,
				driversHash = drivers.length === 0 ? null : drivers.reduce((driversHash, driverId) => {
					driversHash[driverId] = true;
					return driversHash;
				}, {});

			loadEndDate -= LOAD_PERIOD;
			from = new Date(Math.max(loadEndDate, fromDate));

			driverChangeSearch = {
				fromDate: from.toISOString(),
				toDate: to.toISOString(),
				userSearch: {
					DriverGroups: state.getGroupFilter()
				}
			};
			if (drivers.length === 1) {
				driverChangeSearch.userSearch.id = drivers[0];
			}

			api.call("Get", {
				typeName: "DriverChange",
				search: driverChangeSearch
			}, trips => {
				trips = filterTripsByDrivers(trips, driversHash);
				processLoadedPart(trips, drivers);
				if ((fromDate !== null && loadEndDate >= fromDate) || (countOfChanges !== null && loadedCount < countOfChanges)) {
					loadPartOfChanges(fromDate, countOfChanges, drivers);
				} else {
					progress.hide();
					exportButton.removeAttribute("disabled");
				}
			}, loadErrorHandler);
		},
		filterTripsByDrivers = (trips, driversHash) => {
			if (!driversHash) {
				return trips;
			}
			return trips.filter(trip => {
				return !!driversHash[trip.driver.id];
			});
		},
		/* Gets loaded part of trips and add last changes in hash in needed, populates drivers
		 * */
		processLoadedPart = trips => {
			var tasks = (() => {
					var value = 0,
						increase = () => {
							value++;
						},
						decrease = () => {
							value--;
						},
						isComplete = () => {
							return value === 0;
						};

					return {
						increase: increase,
						decrease: decrease,
						isComplete: isComplete
					};
				})(),
				/* Log for sent requests to avoid sending two requests for the same entity
				 * */
				requestsControl = (() => {
					var sentRequests = {},
						DRIVER = "driver_",
						DEVICE = "device_",
						getEntityAPI = entityName => {
							return {
								sent: id => {
									sentRequests[entityName + id] = true;
								},
								complete: id => {
									delete sentRequests[entityName + id];
								},
								isRequestSent: id => {
									return !!sentRequests[entityName + id];
								}
							};
						};

					return {
						devices: getEntityAPI(DEVICE),
						drivers: getEntityAPI(DRIVER)
					};
				})(),
				populatedAllDrivers = () => {
					if (tasks.isComplete()) {
						trips.forEach(trip => {
							var driverId = trip.driver !== "UnknownDriverId" ? trip.driver.id : null,
								driver = driversStorage.getItemById(driverId),
								deviceId = trip.device ? trip.device.id : null,
								device = devicesStorage.getItemById(deviceId);

							trip.driver = driver ? driver : "UnknownDriverId";
							trip.device = device;
						});
						render(toArray(lastInsertKeys));
					}
				};
			trips.forEach(trip => {
				var driverId = trip.driver !== "UnknownDriverId" ? trip.driver.id : null;

				if (!lastInsertKeys[driverId]) {
					lastInsertKeys[driverId] = [];
				}
				lastInsertKeys[driverId].push(trip);


				if (!lastInsertKeys[driverId] || trip.dateTime > lastInsertKeys[driverId].dateTime) {
					lastInsertKeys[driverId] = trip;

					if (driverId) {
						driver = driversStorage.getItemById(driverId);
						if (!driver && !requestsControl.drivers.isRequestSent(driverId)) {
							requestsControl.drivers.sent(driverId);
							api.call("Get", {
								typeName: "User",
								search: {
									id: driverId
								}
							}, driver => {
								if (driver && driver[0]) {
									driversStorage.add(driver);
								}
								requestsControl.drivers.complete(driverId);
								tasks.decrease();
								populatedAllDrivers();
							}, e => {
								requestsControl.drivers.complete(driverId);
								loadErrorHandler(e);
							});
							tasks.increase();
						}
					}

					if (deviceId) {
						device = devicesStorage.getItemById(deviceId);
						if (!device && !requestsControl.devices.isRequestSent(deviceId)) {
							requestsControl.devices.sent(deviceId);
							api.call("Get", {
								typeName: "Device",
								search: {
									id: deviceId
								}
							}, device => {
								if (device && device[0]) {
									devicesStorage.add(device);
								}
								requestsControl.devices.complete(deviceId);
								tasks.decrease();
								populatedAllDrivers();
							}, e => {
								requestsControl.devices.complete(deviceId);
								loadErrorHandler(e);
							});
							tasks.increase();
						}
					}
				}
				loadedCount++;
			});
			populatedAllDrivers();
		},
		entitiesStorage = () => {
			var hash = {},
				add = drivers => {
					var driver, i;

					for (i = 0; i < drivers.length; i++) {
						driver = drivers[i];
						hash[driver.id] = driver;
					}
				},
				clear = () => {
					hash = {};
				},
				getItemById = id => {
					return hash[id] || null;
				};

			return {
				add: add,
				clear: clear,
				getItemById: getItemById
			};
		},
		driversStorage = entitiesStorage(),
		devicesStorage = entitiesStorage(),
		toArray = object => {
			var keys = Object.keys(object),
				array = [],
				i;

			for (i = 0; i < keys.length; i++) {
				array.push(object[keys[i]]);
			}
			return array;
		},
		formatDate = date => {
			return date.toLocaleDateString() + " " + date.toLocaleTimeString().replace(/:\d+ /, " ");
		},
		render = changes => {
			var render = changes => {
				var data = "";

				// Assuming 'changes' is now an object with driver IDs as keys and arrays of changes as values
				Object.keys(changes).forEach(driverId => {
					var driverChanges = changes[driverId];
					driverChanges.forEach(change => {
						// Use your existing rendering logic here for each 'change'
						var row = "<div class='lastInsertKey-row'>";
						row += "<div class='lastInsertKey-cell-name' title='Driver'>" + (change.driver && change.driver !== "UnknownDriverId" ? change.driver.name : "Unknown driver") + " (" + (change.device ? change.device.name : "") + ")</div>";
						row += "<div class='lastInsertKey-cell-secondary'>";
						row += "<div class='lastInsertKey-cell-info lastInsertKey-cell-right lastInsertKey-cell-wide' title='Date of the last change'>" + formatDate(new Date(change.dateTime)) + "</div>";
						row += "<div class='lastInsertKey-cell-info lastInsertKey-cell-right' title='Type of the driver change'>" + change.type + "</div>";
						row += "</div></div>";
						data += row;
					});
				});

				if (data === "") {
					data = "<div class='lastInsertKey-row'><div class='lastInsertKey-cell-name'>There are no driver changes in the selected period.</div></div>";
				}
				gridContainer.innerHTML = data;
			};
		}
		abort = () => {
			progress.hide();
			driversInput.blur();
		},

		addClass = (element, className) => {
			element.className += " " + className;
		},
		removeClass = (element, className) => {
			var regexp = new RegExp(" " + className, "g");
			element.className = element.className.replace(regexp, "");
		},

		progress = (container => {
			var showTimeout = null;
			return {
				show: () => {
					showTimeout = window.setTimeout(() => {
						container.style.display = "block";
						showTimeout = null;
					}, 100);
				},
				hide: () => {
					if (showTimeout) {
						window.clearTimeout(showTimeout);
						showTimeout = null;
					}
					container.style.display = "none";
				}
			};
		})(container.querySelector("#lastInsertKey-progress")),

		driversInput = ((container, searchHandler) => {
			var searchContainer = document.createElement("input"),
				optionsContainer = document.createElement("div"),
				placeholderContainer = document.createElement("div"),
				getValue = () => {
					return Object.keys(markers);
				},

				options = [],
				setOptions = newOptions => {
					options = newOptions;
					renderOptions(options);
				},
				renderOptions = options => {
					var option,
						optionsHTML = "",
						i;

					for (i = 0; i < options.length; i++) {
						option = options[i];
						optionsHTML += "<div class='lastInsertKey-option' data-item-id='" + option.id + "'>" + option.name + "</div>";
					}
					optionsContainer.innerHTML = optionsHTML;
				},
				markers = {},
				createMarker = item => {
					var marker = document.createElement("div"),
						removeButton = document.createElement("div"),
						removeTimeout = null,
						removeHandler = () => {
							if (!removeTimeout) {
								removeTimeout = window.setTimeout(() => {
									removeButton.removeEventListener("click", removeHandler, false);
									marker.parentNode.removeChild(marker);
									marker = null;
									removeButton = null;
									removeTimeout = null;
									delete markers[item.id];
									setOptionsState();
									showPlaceholder();
								}, 1);
							}
						};

					marker.className = "lastInsertKey-marker";
					marker.appendChild(document.createTextNode(item.name));

					removeButton.className = "lastInsertKey-remove-icon";
					marker.appendChild(removeButton);
					removeButton.addEventListener("click", removeHandler, false);

					container.insertBefore(marker, searchContainer);

					markers[item.id] = marker;
					setOptionsState();
					hidePlaceholder();
				},
				containerClickHandler = e => {
					if (isClickInsideArea(e.target)) {
						if (optionsContainer.style.display !== "block") {
							window.setTimeout(showOptions, 1);
						}
						searchContainer.focus();
					}
				},
				showOptions = () => {
					var position,
						pageHeight = document.body.offsetHeight;

					if (optionsContainer.style.display !== "block") {
						optionsContainer.style.maxHeight = "none";
						optionsContainer.style.display = "block";
						removeClass(optionsContainer, "lastInsertKey-options-upper");
					}

					position = optionsContainer.getBoundingClientRect();
					if (position.top + position.height > pageHeight) {
						optionsContainer.style.maxHeight = (pageHeight - position.top - 6) + "px";
					}

					position = optionsContainer.getBoundingClientRect();
					if ((pageHeight - position.top) < 60) {
						optionsContainer.style.maxHeight = "none";
						addClass(optionsContainer, "lastInsertKey-options-upper");
						position = optionsContainer.getBoundingClientRect();
						if (position.top < 0) {
							optionsContainer.style.maxHeight = (position.bottom - 46) + "px";
						}
					}
				},
				setOptionsState = () => {
					Array.prototype.forEach.call(optionsContainer.childNodes, item => {
						var id = item.getAttribute("data-item-id");
						if (markers[id]) {
							addClass(item, "lastInsertKey-selected");
						} else {
							removeClass(item, "lastInsertKey-selected");
						}
					});
				},
				hideOptions = () => {
					optionsContainer.style.display = "none";
				},
				locateOption = target => {
					var itemId;
					while (target) {
						itemId = target.getAttribute("data-item-id");
						if (itemId !== null) {
							return target;
						}
						if (target === optionsContainer) {
							return null;
						}
						target = target.parentNode;
					}
					return null;
				},
				clickOptionHandler = e => {
					var itemElement = locateOption(e.target),
						itemId = itemElement.getAttribute("data-item-id");

					addItem(itemId);
				},
				addItem = itemId => {
					var item, i;
					if (itemId && !markers[itemId]) {
						for (i = 0; i < options.length; i++) {
							if (options[i].id === itemId) {
								item = options[i];
								break;
							}
						}
						if (item) {
							createMarker(item);
							setOptionsState();
						}
					}
				},
				isClickInsideArea = target => {
					var isClickInsideArea = false;
					while (target) {
						if (target === container) {
							isClickInsideArea = true;
							break;
						}
						target = target.parentNode;
					}
					return isClickInsideArea;
				},
				clickBodyHandler = e => {
					if (!isClickInsideArea(e.target)) {
						hideOptions();
					}
				},
				resizeSearchInput = () => {
					var length = searchContainer.value.length;
					searchContainer.style.width = Math.max(4, length * 0.9) + "em";
				},
				searchItems = e => {
					var keycode = e ? e.keyCode : null;
					switch (keycode) {
						case 38:
							// move selection up;
							moveHover(-1);
							break;
						case 40:
							// move selection down;
							moveHover(1);
							break;
						case 13:
							// enter
							enterHandler(e);
							break;
						default:
							window.setTimeout(() => {
								var query = (searchContainer.value || "").trim();

								if (searchHandler) {
									searchHandler(query, () => {
										renderOptions(options);
										setOptionsState();
										showOptions();
									});
								} else {
									if (query.length > 0) {
										// filter options by keyword
										renderOptions(options.filter(option => {
											return option.name.indexOf(query) > -1;
										}));
									} else {
										// show all items
										renderOptions(options);
									}
								}
								setOptionsState();
								showOptions();
							}, 50);
					}
				},
				// direction:
				//  1 - down
				// -1 - up
				moveHover = direction => {
					var availableItems = [],
						hoverItem = null;

					Array.prototype.forEach.call(optionsContainer.childNodes, (item, index) => {
						if (item.className && item.className.indexOf("lastInsertKey-selected") === -1) {
							availableItems.push(index);
						}
						if (item.className && item.className.indexOf("hover") > -1) {
							hoverItem = availableItems.length - 1;
						}
					});

					if (availableItems.length > 0) {
						if (hoverItem === null) {
							hoverItem = -1;
						}
						hoverItem += direction;

						if (hoverItem < 0) {
							hoverItem = availableItems.length - 1;
						}
						if (hoverItem > availableItems.length - 1) {
							hoverItem = 0;
						}
						hoverItem = availableItems[hoverItem];
					}

					Array.prototype.forEach.call(optionsContainer.childNodes, (item, i) => {
						if (i === hoverItem) {
							addClass(item, "hover");
						} else {
							removeClass(item, "hover");
						}
					});
				},
				enterHandler = () => {
					var item = optionsContainer.querySelector(".hover"),
						itemId;
					if (item) {
						itemId = item.getAttribute("data-item-id");
						addItem(itemId);
					}
				},
				hoverHandler = e => {
					var hoverItem = locateOption(e.target);
					Array.prototype.forEach.call(optionsContainer.childNodes, item => {
						if (item === hoverItem) {
							addClass(item, "hover");
						} else {
							removeClass(item, "hover");
						}
					});
				},
				hidePlaceholder = () => {
					placeholderContainer.style.display = "none";
				},
				showPlaceholder = () => {
					if (container.querySelectorAll(".lastInsertKey-marker").length === 0 && searchContainer.value.length === 0) {
						placeholderContainer.style.display = "block";
					}
				},
				focus = () => {
					document.body.addEventListener("click", clickBodyHandler, false);
				},
				blur = () => {
					document.body.removeEventListener("click", clickBodyHandler, false);
				};

			container.className = "lastInsertKey-autocomplete";
			optionsContainer.className = "lastInsertKey-options-list";
			searchContainer.className = "lastInsertKey-search";
			placeholderContainer.className = "lastInsertKey-placeholder";
			placeholderContainer.appendChild(document.createTextNode("All drivers"));
			container.appendChild(placeholderContainer);
			container.appendChild(searchContainer);
			container.appendChild(optionsContainer);

			container.addEventListener("click", containerClickHandler, false);

			searchContainer.addEventListener("keyup", resizeSearchInput, false);
			searchContainer.addEventListener("keyup", searchItems, false);
			optionsContainer.addEventListener("click", clickOptionHandler, false);
			optionsContainer.addEventListener("mousemove", hoverHandler, false);

			// placeholder events
			searchContainer.addEventListener("focus", () => {
				window.setTimeout(showOptions, 1);
				hidePlaceholder();
			}, false);
			searchContainer.addEventListener("blur", () => {
				window.setTimeout(() => {
					showPlaceholder();
				}, 100);
			}, false);

			return {
				getValue: getValue,
				setOptions: setOptions,
				focus: focus,
				blur: blur
			};
		})(document.querySelector(".lastInsertKey-drivers"), (keyword, callback) => {
			var userSearch = {
				isDriver: true,
				driverGroups: state.getGroupFilter()
			};
			if (keyword.length > 0) {
				userSearch.name = "%" + keyword + "%";
			}
			api.call("Get", {
				typeName: "User",
				search: userSearch,
				resultsLimit: 100
			}, drivers => {
				driversInput.setOptions(drivers);
				callback();
			}, loadErrorHandler);
		}),

		sortController = (() => {
			var sortOrder = 1,
				sortBy = "name",

				setSortBy = newSortBy => {
					if (sortByFunc[newSortBy]) {
						if (newSortBy !== sortBy) {
							sortOrder = 1;
							sortBy = newSortBy;
						} else {
							sortOrder *= -1;
						}
						return true;
					} else {
						return false;
					}
				},
				getSortBy = () => {
					var sortHandler = sortByFunc[sortBy] ? sortByFunc[sortBy] : sortByFunc["name"];
					return (a, b) => {
						return sortHandler(a, b) * sortOrder;
					};
				},
				sortByFunc = {
					name: (a, b) => {
						var aName = ((a.driver && a.driver !== "UnknownDriverId" && a.driver.name) ? a.driver.name : "Unknown Driver").toLowerCase(),
							bName = ((b.driver && b.driver !== "UnknownDriverId" && b.driver.name) ? b.driver.name : "Unknown Driver").toLowerCase();
						return aName > bName ? 1 : -1;
					},
					date: (a, b) => {
						return a.dateTime > b.dateTime ? 1 : -1;
					},
					type: (a, b) => {
						if (a.type === b.type) {
							return a.name > b.name ? -1 : 1;
						} else {
							return a.type > b.type ? -1 : 1;
						}
					}
				};

			return {
				setSortBy: setSortBy,
				getSortBy: getSortBy
			};
		})(),
		sortByName = () => {
			sortController.setSortBy("name");
			lastInsertKeys && render(toArray(lastInsertKeys));
		},
		sortByDate = () => {
			sortController.setSortBy("date");
			lastInsertKeys && render(toArray(lastInsertKeys));
		},
		sortByType = () => {
			sortController.setSortBy("type");
			lastInsertKeys && render(toArray(lastInsertKeys));
		},

		exportToXLSX = () => {
			var Workbook = function() {
					this.SheetNames = [];
					this.Sheets = {};
				},
				s2ab = s => {
					var buf = new ArrayBuffer(s.length);
					var view = new Uint8Array(buf);
					for (var i = 0; i != s.length; ++i) view[i] = s.charCodeAt(i) & 0xFF;
					return buf;
				},
				workbook = new Workbook(),
				worksheetName = "Report",
				worksheet = {},
				range = {
					s: {
						c: 0,
						r: 0
					},
					e: {
						c: 2,
						r: 65536
					}
				},
				headerRows = 4,

				alignLeft = {
					horizontal: "left"
				},
				alignRight = {
					horizontal: "right"
				},
				cellFills = [{
					fgColor: "ffffff"
				}],
				cellStyles = [{
						applyFill: "1",
						applyBorder: "1",
						borderId: "0",
						fillId: "2",
						fontId: "1",
						numFmtId: 0,
						xfId: "0",
						applyAlignment: "1",
						alignment: alignLeft
					},
					{
						applyFill: "1",
						applyBorder: "1",
						borderId: "0",
						fillId: "2",
						fontId: "2",
						numFmtId: 0,
						xfId: "0"
					},
					{
						applyFill: "1",
						applyBorder: "1",
						borderId: "0",
						fillId: "2",
						fontId: "2",
						numFmtId: 0,
						xfId: "0",
						applyAlignment: "1",
						alignment: alignRight
					},
					{
						applyFill: "1",
						applyBorder: "1",
						borderId: "0",
						fillId: "2",
						fontId: "1",
						numFmtId: "15",
						xfId: "0",
						applyAlignment: "1",
						alignment: alignLeft
					},
					{
						applyFill: "1",
						applyBorder: "1",
						borderId: "0",
						fillId: "2",
						fontId: "1",
						numFmtId: "25",
						xfId: "0",
						alignment: alignLeft
					}
				],

				wbout,
				i,
				changes, change,
				driverName, dateTime, changeType, row;

			worksheet["!cols"] = [{
					wch: 35
				},
				{
					wch: 25
				},
				{
					wch: 20
				}
			];
			// Range and frozen cells
			worksheet["!ref"] = XLSX.utils.encode_range(range);
			worksheet["!frozen"] = headerRows;

			// Created date
			worksheet.A1 = {
				v: "Created",
				s: 2
			};
			worksheet.B1 = {
				v: new Date(),
				s: 3,
				t: "d"
			};

			// Total count
			worksheet.A2 = {
				v: "Total",
				s: 2
			};
			worksheet.B2 = {
				v: "",
				f: "COUNTA(A5:A65536)",
				t: "n"
			};

			// Grid header
			worksheet.A4 = {
				v: "Driver",
				s: 1
			};
			worksheet.B4 = {
				v: "Date",
				s: 1
			};
			worksheet.C4 = {
				v: "Type",
				s: 1
			};


			changes = toArray(lastInsertKeys);
			changes = changes.sort(sortController.getSortBy());

			for (i = 0; i < changes.length; i++) {
				change = changes[i];
				driverName = change.driver && change.driver !== "UnknownDriverId" && change.driver.name ? change.driver.name : "Unknown driver";
				dateTime = new Date(change.dateTime);
				changeType = change.type;
				row = XLSX.utils.encode_row(headerRows + i);

				worksheet["A" + row] = {
					v: driverName
				};
				worksheet["B" + row] = {
					v: dateTime,
					s: 4,
					t: "d"
				};
				worksheet["C" + row] = {
					v: changeType
				};
			}

			/* add worksheet to workbook */
			workbook.SheetNames.push(worksheetName);
			workbook.Sheets[worksheetName] = worksheet;

			wbout = XLSX.write(workbook, {
				bookType: "xlsx",
				bookSST: true,
				type: "binary",
				cellXfs: cellStyles,
				fills: cellFills
			});

			saveAs(new Blob([s2ab(wbout)], {
				type: "application/octet-stream"
			}), "LastInsertKeyReport.xlsx");
		};

	/* Public Methods */
	return {
		/*
		 * Page lifecycle method: initialize is called once when the Add-In first starts
		 * Use this function to initialize the Add-In's state such as default values or
		 * make API requests (Geotab or external) to ensure interface is ready for the user.
		 */
		initialize(api, state, callback) {
			if (callback) {
				callback();
			}
			initialize();
		},

		/*
		 * Page lifecycle method: focus is called when the page has finished initialize method
		 * and again when a user leaves and returns to your Add-In that has already been initialized.
		 * Use this function to refresh state such as vehicles, zones or exceptions which may have
		 * been modified since it was first initialized.
		 */
		focus() {
			focus();
		},

		/*
		 * Page lifecycle method: blur is called when the user is leaving your Add-In.
		 * Use this function to save state or commit changes to a datastore or release memory.
		 */
		blur() {
			abort();
		}
	};
};