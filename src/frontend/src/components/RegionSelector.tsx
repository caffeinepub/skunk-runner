import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Region {
  id: string;
  name: string;
}

interface RegionSelectorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  regions: Region[];
  placeholder?: string;
}

export function RegionSelector({
  label,
  value,
  onChange,
  regions,
  placeholder = "Select a region",
}: RegionSelectorProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={`region-${label}`} className="text-base font-medium">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={`region-${label}`} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {regions.map((region) => (
            <SelectItem key={region.id} value={region.id}>
              {region.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
