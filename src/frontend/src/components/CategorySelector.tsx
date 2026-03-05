import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Category {
  id: string;
  name: string;
}

interface CategorySelectorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  categories: Category[];
  placeholder?: string;
}

export function CategorySelector({
  label,
  value,
  onChange,
  categories,
  placeholder = "Select a category",
}: CategorySelectorProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor="category" className="text-base font-medium">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="category" className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {categories.map((category) => (
            <SelectItem key={category.id} value={category.id}>
              {category.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
