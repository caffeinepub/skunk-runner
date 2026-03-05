import Map "mo:core/Map";
import Text "mo:core/Text";
import List "mo:core/List";
import Float "mo:core/Float";
import Order "mo:core/Order";
import Array "mo:core/Array";
import Runtime "mo:core/Runtime";

actor {
  type InflationSeries = [(Nat, Float)];
  type CategoryRequest = {
    region : Text;
    category : Text;
  };
  type RegionalCategories = Map.Map<Text, InflationSeries>;

  let regionalInflationData = Map.empty<Text, RegionalCategories>();

  public func getRegionalCategories(region : Text) : async [Text] {
    switch (regionalInflationData.get(region)) {
      case (?categories) { categories.keys().toArray() };
      case (null) { Runtime.trap("Region not found: " # region) };
    };
  };

  func validateRegion(region : Text) {
    if (region.trimStart(#char ' ').trimEnd(#char ' ') == "") {
      Runtime.trap("Region cannot be empty");
    };
  };

  func validateCategory(category : Text) {
    if (category.trimStart(#char ' ').trimEnd(#char ' ') == "") {
      Runtime.trap("Category cannot be empty");
    };
  };

  public func getInflationData(request : CategoryRequest) : async InflationSeries {
    validateRegion(request.region);
    validateCategory(request.category);

    switch (regionalInflationData.get(request.region)) {
      case (?regionalData) {
        switch (regionalData.get(request.category)) {
          case (?series) { series };
          case (null) {
            Runtime.trap("Category not found for region " # request.region # ": " # request.category);
          };
        };
      };
      case (null) { Runtime.trap("Region not found: " # request.region) };
    };
  };

  func compareFloatsDescending(a : Float, b : Float) : Order.Order {
    Float.compare(b, a);
  };

  public func getTopInflationSubcategories(region : Text, n : Nat) : async [(Text, Float)] {
    validateRegion(region);

    switch (regionalInflationData.get(region)) {
      case (?regionalData) {
        let categoriesList = List.empty<(Text, Float)>();
        for ((category, series) in regionalData.entries()) {
          if (series.size() > 1) {
            let firstYear = series[0].1;
            let lastYear = series[series.size() - 1].1;
            let change = lastYear - firstYear;
            categoriesList.add((category, change));
          };
        };
        let sortedCategories = categoriesList.toArray().sort(
          func(a, b) { compareFloatsDescending(a.1, b.1) }
        );
        Array.tabulate<(Text, Float)>(
          if (n > sortedCategories.size()) { sortedCategories.size() } else { n },
          func(i) { sortedCategories[i] },
        );
      };
      case (null) { Runtime.trap("Region not found: " # region) };
    };
  };
};
